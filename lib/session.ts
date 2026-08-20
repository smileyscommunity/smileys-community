import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
// Constant only. lib/city imports just a TYPE from here, so this adds no
// runtime cycle — keep it that way if either module grows.
import { VIEW_CITY_COOKIE } from '@/lib/city'

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set')
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET)
const COOKIE = 'smileys_session'

// Session lifetime — 7 days. Keep in sync with the Session.expiresAt
// computation in createSession() and the JWT `.setExpirationTime('7d')`.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface SessionUser {
  id: string
  name: string
  email: string
  role: string
  color: string
  bio?: string
  neighborhood?: string
  instagram?: string
  emailVerified?: boolean
  partnerId?: string
  tokenVersion?: number
  // City the user belongs to — drives moderator scoping. Optional in
  // the type because JWTs issued before the multi-city scaffolding
  // landed don't carry it; getSession() refreshes it from the DB on
  // every request alongside the existing status/suspension checks so
  // every code path gets a fresh value regardless of JWT age.
  cityId?: string
  // Per-device session id. Embedded as the JWT `jti` claim. getSession()
  // verifies the corresponding Session row exists + isn't revoked. Lets
  // users sign out individual devices via /api/auth/sessions/[id].
  // Undefined on legacy JWTs issued before this column was added —
  // backward-compat path in getSession() accepts them until expiry.
  sessionId?: string
  // Refreshed from DB on every request — used by isAdmin/isAdminOrModerator
  // to enforce mandatory 2FA for privileged roles server-side.
  totpEnabled?: boolean
  // True when this session was created via the 2FA verify step (TOTP or
  // backup code). Checked server-side so a valid cookie from a
  // password-only login can't reach admin routes even when 2FA is enrolled.
  totpVerified?: boolean
}

interface CreateOptions {
  userAgent?: string | null
  ip?: string | null
  // When set, re-issue the JWT keeping the existing Session row (same
  // `jti`). Used by profile-refresh paths in /api/auth/me — we want a
  // fresh JWT with updated name/partner/etc. but the same device session
  // row, otherwise every profile edit pollutes /settings with a new
  // device. Read from `session.sessionId` on the caller side.
  reuseSessionId?: string
  // Set to true when the session is created after a successful TOTP (or
  // backup-code) verification — stored on the Session row so getSession()
  // can surface it without trusting the JWT payload.
  totpVerified?: boolean
}

export async function createSession(user: SessionUser, opts: CreateOptions = {}) {
  let jti = opts.reuseSessionId
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  if (!jti) {
    // Persist the per-device row first so we can embed its ID in the JWT.
    // userAgent + ip are captured at issuance time only; they're not
    // updated on every request because the device fingerprint of a
    // session shouldn't change mid-flight.
    const row = await prisma.session.create({
      data: {
        userId:       user.id,
        userAgent:    opts.userAgent?.slice(0, 500) ?? null,
        ip:           opts.ip ?? null,
        expiresAt,
        totpVerified: opts.totpVerified ?? false,
      },
      select: { id: true },
    })
    jti = row.id
  } else {
    // Re-issue path. The new JWT carries fresh 7d expiry, so the matching
    // Session row's expiresAt has to slide forward too — otherwise an
    // actively-used account gets force-signed-out the moment the original
    // row's expiresAt passes. updateMany so a missing row (e.g. the user
    // revoked it from another device mid-flight) doesn't throw; the next
    // getSession will then drop them as expected.
    await prisma.session.updateMany({
      where: { id: jti, revokedAt: null },
      data:  { expiresAt },
    })
  }

  const token = await new SignJWT({ user, jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(SECRET)

  const cookieStore = await cookies()
  cookieStore.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(COOKIE)?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, SECRET)
    const user = payload.user as SessionUser
    const jti = typeof payload.jti === 'string' ? payload.jti : undefined

    // Real-time check: ban/suspension + tokenVersion (logout invalidates all sessions)
    // + per-device Session row (per-device revocation). Combine into a
    // single round trip via a parallel fetch.
    const [dbUser, sessionRow] = await Promise.all([
      prisma.user.findUnique({
        where: { id: user.id },
        select: { status: true, suspendedUntil: true, tokenVersion: true, cityId: true, email: true, totpEnabled: true, neighborhood: true },
      }),
      // Skip the Session lookup when the JWT has no jti (legacy session
      // issued before the per-device column was added). Those expire
      // naturally at 7 days, at which point every active session is
      // tracked and the backward-compat path can be removed.
      jti
        ? prisma.session.findUnique({
            where:  { id: jti },
            select: { id: true, expiresAt: true, revokedAt: true, totpVerified: true },
          })
        : Promise.resolve(null),
    ])
    if (!dbUser || dbUser.status === 'banned') {
      await deleteSession(dbUser ? 'banned' : undefined)
      return null
    }
    if (dbUser.suspendedUntil && new Date(dbUser.suspendedUntil) > new Date()) {
      await deleteSession('suspended')
      return null
    }
    // JWTs issued before this column existed have no tokenVersion — treat as 0,
    // which matches the DB default so existing sessions remain valid.
    const jwtVersion = user.tokenVersion ?? 0
    if (jwtVersion !== dbUser.tokenVersion) {
      await deleteSession()
      return null
    }
    // Per-device check: if the JWT carries a jti, the matching Session
    // row must exist, not be revoked, and not be past its expiry.
    if (jti) {
      if (!sessionRow || sessionRow.revokedAt || sessionRow.expiresAt < new Date()) {
        await deleteSession()
        return null
      }
      // Best-effort: stamp lastUsedAt so the device list in /settings is
      // accurate. Fire-and-forget — we don't want a Prisma hiccup here
      // to slow down every authenticated request.
      prisma.session.update({
        where: { id: jti },
        data:  { lastUsedAt: new Date() },
      }).catch(() => {})
    }

    // Inject the live cityId + email + neighborhood from the DB so
    // capability checks, audit-log attribution and personalization have
    // fresh values even for sessions issued before later edits. (The
    // login JWT never carried neighborhood at all, so without this the
    // neighborhoods pages treated every member as having none.) Avoids
    // forcing every member to re-login.
    return { ...user, cityId: dbUser.cityId, email: dbUser.email, neighborhood: dbUser.neighborhood ?? undefined, totpEnabled: dbUser.totpEnabled, totpVerified: sessionRow?.totpVerified ?? false, sessionId: jti }
  } catch {
    return null
  }
}

// Why a session ended, for the one case the member can't work out themselves.
// Being signed out mid-session with no explanation is indistinguishable from a
// bug: they only learn they were suspended if they happen to try logging in
// again, where /api/auth/login has told them properly all along.
//
// A separate short-lived cookie rather than a redirect, because getSession()
// returns null — it has no way to redirect anything — and the layout that does
// bounce them only knows `isLoggedIn === false`. Deliberately readable by the
// client: /login is a client component, and the value is a reason code, not a
// credential. Five minutes is long enough to survive the bounce and short
// enough that a stale one can't explain some later, unrelated sign-out.
export const SIGNOUT_REASON_COOKIE = 'smileys_signed_out'
export type SignoutReason = 'suspended' | 'banned'

export async function deleteSession(reason?: SignoutReason) {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE)?.value

  // Cookies can only be written in a Route Handler or Server Action. This is
  // also reached from getSession() during PAGE RENDERS — the suspension, ban
  // and tokenVersion checks all invalidate mid-request — and there Next throws
  // "Cookies can only be modified in a Server Action or Route Handler".
  //
  // That throw used to escape into getSession's catch, which returned null.
  // Right answer, wrong route: it skipped everything below, so the Session row
  // survived, the cookie was never cleared, and the sign-out reason was never
  // set — on a render, which is exactly when a member gets ejected mid-session.
  //
  // Best-effort instead. The session is dead either way (getSession returns
  // null regardless), and the next route handler runs this again where the
  // writes are legal — AuthContext polls /api/auth/me, so that happens within
  // moments rather than eventually.
  try {
    cookieStore.delete(COOKIE)

    // The view-city override is per-PERSON state, not per-browser, and nothing
    // used to clear it: it was written only by /api/city/enter and
    // /api/me/view-city, and survived sign-out. So on a shared browser someone
    // could look at Bodrum, sign out, and the next member to sign in landed in
    // Bodrum instead of their own city — with no visible cause, since the
    // switcher was never touched. Same effect for a member who changes home
    // city while an old override lingers.
    //
    // Cleared by setting empty rather than delete(): on https the original set
    // is Secure, and browsers refuse to let a non-Secure Set-Cookie overwrite a
    // Secure one, so a bare delete silently no-ops on iOS. /api/city/enter
    // learned that the hard way — same attributes here for the same reason.
    //
    // Deliberately NOT cleared on sign-IN: a guest who browses Bodrum and then
    // signs in should stay in Bodrum. Sign-out is where the person changes.
    cookieStore.set(VIEW_CITY_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
      path:     '/',
      maxAge:   0,
    })

    if (reason) {
      cookieStore.set(SIGNOUT_REASON_COOKIE, reason, {
        httpOnly: false,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge:   300,
        path:     '/',
      })
    }
  } catch {
    // Render context. Nothing to do here — see above.
  }

  // Also nuke the Session row for THIS device so the list in /settings
  // updates immediately. Outside the try above on purpose: a database write
  // is legal during a render even though a cookie write isn't, and this is
  // the half that revokes the session for every other request. Fail-soft —
  // a missing row doesn't matter functionally.
  if (token) {
    try {
      const { payload } = await jwtVerify(token, SECRET)
      const jti = typeof payload.jti === 'string' ? payload.jti : null
      if (jti) {
        await prisma.session.deleteMany({ where: { id: jti } })
      }
    } catch { /* expired or tampered token — nothing to delete */ }
  }
}

// Use on full account-wide invalidation (logout-everywhere, password change,
// role demotion, account deletion). Bumps tokenVersion so every active JWT
// fails the freshness check in getSession() AND drops every Session row
// for the user so /settings reflects the wipe.
