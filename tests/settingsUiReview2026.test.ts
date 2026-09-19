import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The /settings UI review (2026-09-20) — the browser half of the same pass
// tests/settingsReview2026 covers server-side. The push toggle turned itself
// back on, the push section could never render at all, a failed preferences
// load saved all-true defaults over the member's real choices, the toggle
// labels each described one of the several notification types they mute, and
// the email / password / delete forms knew nothing about 2FA or about a
// change already waiting to be confirmed. These pin the fixes.

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

const page     = read('app/(member)/settings/page.tsx')
const pushLib  = read('lib/pushDevice.ts')
const prompt   = read('components/PushPermission.tsx')
const devices  = read('components/settings/ActiveDevicesSection.tsx')
const twoFa    = read('components/settings/TwoFactorSection.tsx')
const homeCity = read('components/settings/HomeCitySection.tsx')
const del      = read('components/settings/DeleteAccountSection.tsx')

describe('push notifications', () => {
  it('turning the toggle off is remembered per device, and the prompt respects it', () => {
    expect(pushLib).toContain("export const PUSH_OPTED_OUT_KEY = 'smileys_push_opted_out'")
    // Storage can throw in a private window — every read and write is guarded.
    expect(pushLib).toMatch(/export function pushOptedOut\(\): boolean \{\s*try \{/)
    expect(pushLib).toMatch(/export function setPushOptedOut\(optedOut: boolean\): void \{\s*try \{/)
    // disable() records the refusal; enable() clears it.
    expect(page).toMatch(/setPushOptedOut\(true\)\s*setState\('off'\)/)
    expect(page).toMatch(/setPushOptedOut\(false\)\s*rememberPushSynced\(userId\)\s*setState\('on'\)/)
    // The prompt's re-sync is what used to flip it back on.
    expect(prompt).toMatch(/if \(!pushOptedOut\(\)\) \{/)
    expect(prompt).toContain('setPushOptedOut(false)')
  })

  it('enabling here stamps the sync the prompt reads, so nothing is "due" straight away', () => {
    expect(pushLib).toMatch(/export function rememberPushSynced\(userId: string\): void \{[\s\S]*?localStorage\.setItem\(PUSH_SYNCED_USER_KEY, userId\)[\s\S]*?localStorage\.setItem\(PUSH_SYNCED_KEY, String\(Date\.now\(\)\)\)/)
    expect(page).toContain("import { pushOptedOut, setPushOptedOut, rememberPushSynced, forgetPushSync } from '@/lib/pushDevice'")
  })

  it('a dismissed browser prompt is not treated as blocked', () => {
    expect(page).toMatch(/if \(permission === 'denied'\) \{ setState\('denied'\); return \}/)
    expect(page).toContain('toast("Notifications weren\'t enabled — tap again if you want them.")')
    // 'default' keeps the toggle rather than showing the unblock dead end.
    expect(page).not.toMatch(/if \(permission !== 'granted'\) \{ setState\('denied'\); return \}/)
  })

  it('the section can actually render: getRegistration with a timeout, never .ready', () => {
    expect(page).toContain('navigator.serviceWorker.getRegistration()')
    // Only the comment explaining why may mention .ready; nothing awaits it.
    expect(page).not.toMatch(/await navigator\.serviceWorker\.ready/)
    expect(page).toMatch(/Promise\.race\(\[[\s\S]*?setTimeout\(\(\) => resolve\(null\), ms\)/)
    // Only 'loading' renders nothing now; the rest say why.
    expect(page).toMatch(/if \(state === 'loading'\) return null/)
    expect(page).toContain('Push isn&apos;t available in this browser')
    expect(page).toContain('Add Smileys to your Home Screen to get notifications')
    expect(page).toMatch(/function isIosBrowserNotInstalled\(\)/)
  })
})

describe('notification preferences', () => {
  it('a failed load is shown as a failure, not as all-true defaults', () => {
    expect(page).toMatch(/if \(!res\.ok\) throw new Error\('failed'\)/)
    expect(page).toMatch(/catch \{\s*setPrefsState\('error'\)/)
    expect(page).toMatch(/prefsState === 'error' \?/)
    expect(page).toMatch(/onClick=\{loadPrefs\}/)
    // And nothing saves from a screen that never loaded.
    expect(page).toMatch(/if \(prefsState !== 'ready' \|\| savingPref\) return/)
  })

  it('a save sends only the key that changed and rolls back to the server value', () => {
    expect(page).toContain('body: JSON.stringify({ [key]: value }),')
    expect(page).toMatch(/setPrefs\(p => \(\{ \.\.\.p, \[key\]: serverPrefs\.current\[key\] \} as Prefs\)\)/)
    // Whole-object PUTs are gone — that's what overwrote real settings.
    expect(page).not.toContain('body: JSON.stringify(updated),')
  })

  it('a toggle is disabled while its own save is in flight', () => {
    expect(page).toContain("disabled={savingPref === 'newEvents'}")
    expect(page).toContain("disabled={savingPref === 'quietHours'}")
    expect(page).toContain("disabled={openSaving === 'openToCoffee'}")
  })

  it('the labels describe everything each preference gates', () => {
    // lib/notify PREF_KEY: joinedEvents also covers event_message + event_photos.
    expect(page).toContain("and the event's chat messages and photos")
    // reminders also covers review_request and reconfirm_ask.
    expect(page).toContain('still coming?')
    expect(page).toContain('review request')
    // newEvents also covers new_hangout, new_article and availability_pulse.
    expect(page).toContain('new articles')
    expect(page).toContain('free to meet')
    // wallReplies also covers board_reply + board_interest.
    expect(page).toContain('replies and interest on your board posts')
  })

  it('quiet hours: push only, home city clock, no equal bounds, padded hours', () => {
    expect(page).toContain('Quiet hours drop the push only')
    expect(page).toContain('emails arrive as usual')
    expect(page).toMatch(/The clock is your home city&apos;s/)
    expect(page).toMatch(/function saveQuietBound\(key: 'quietFrom' \| 'quietTo', value: number\) \{[\s\S]*?if \(value === other\) \{/)
    expect(page).toContain('disabled={i === prefs.quietTo}')
    expect(page).toContain('disabled={i === prefs.quietFrom}')
    // 9:00 padded to 09:00 in the summary line too.
    expect(page).toContain("${String(prefs.quietFrom).padStart(2, '0')}:00")
  })
})

describe('email address', () => {
  it('the address is validated before a request is spent on it', () => {
    expect(page).toContain('const EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/')
    expect(page).toMatch(/if \(!EMAIL_RE\.test\(newEmail\.trim\(\)\)\)/)
  })

  it('a pending change is shown, cancellable, and says a password change ends it', () => {
    expect(page).toMatch(/fetch\('\/app\/api\/auth\/update-email', \{ credentials: 'include' \}\)/)
    expect(page).toContain('Waiting for you to confirm at')
    expect(page).toMatch(/fetch\('\/app\/api\/auth\/update-email', \{ method: 'DELETE', credentials: 'include' \}\)/)
    expect(page).toContain('Changing your password also cancels it.')
    // Expiry on the city clock, h23 — never hour12:false.
    expect(page).toMatch(/hourCycle: 'h23'/)
    expect(page).not.toContain('hour12: false')
  })

  it('the TOTP flow survives', () => {
    expect(page).toMatch(/if \(data\.error === 'code_required'\) \{\s*setEmailNeedsTotp\(true\)/)
  })
})

describe('password and delete account ask for a code on 2FA accounts', () => {
  it('the password form sends and reveals a code', () => {
    expect(page).toContain('body: JSON.stringify({ currentPassword: current, newPassword: newPw, code: pwTotp || undefined }),')
    expect(page).toMatch(/\} else if \(data\.error === 'code_required'\) \{[\s\S]*?setPwNeedsTotp\(true\)/)
    expect(page).toContain('{pwNeedsTotp && (')
  })

  it('delete account sends and reveals a code, and cannot hang on a dropped request', () => {
    expect(del).toContain('body:        JSON.stringify({ password, code: totp || undefined }),')
    expect(del).toMatch(/if \(d\.error === 'code_required'\) \{\s*setNeedsTotp\(true\)/)
    expect(del).toMatch(/catch \{\s*setError\('Could not reach the server — try again'\)/)
  })

  it('the delete copy matches what the route actually does', () => {
    expect(del).toContain('Upcoming events you host are cancelled')
    expect(del).toContain('is notified')
    expect(del).toContain('work details')
    expect(del).toContain('Reviews you left in public stay, with your rating but no text.')
    expect(del).toMatch(/Emails we&apos;ve already sent you can&apos;t be\s*recalled, and payment records are kept for accounting\./)
  })
})

describe('home city', () => {
  it('the confirmation says the neighbourhood goes, and the move is a full page load', () => {
    expect(homeCity).toContain('The neighbourhood on your profile is cleared')
    expect(homeCity).toContain("window.location.assign('/app/settings')")
    // The notice afterwards points at /profile — it has to outlive the reload.
    expect(homeCity).toContain("const MOVED_KEY = 'smileys_home_city_moved'")
    expect(homeCity).toMatch(/<Link href="\/profile"/)
    expect(homeCity).toContain('neighborhoodCleared')
  })
})

describe('two-factor section', () => {
  it('renders for anyone enrolled, not only for staff', () => {
    expect(page).toMatch(/\{\(user\.role === 'admin' \|\| user\.role === 'moderator' \|\| user\.totpEnabled\) && \(/)
    expect(page).toContain("canEnroll={user.role === 'admin' || user.role === 'moderator'}")
  })

  it('offers the secret for a phone that cannot scan its own screen', () => {
    expect(twoFa).toContain('Can&apos;t scan? Enter this code manually')
    expect(twoFa).toContain("setSecret(typeof d.secret === 'string' ? d.secret : null)")
  })

  it('only a 400 means "not enrolled" — anything else is unknown, with a retry', () => {
    expect(twoFa).toMatch(/\} else if \(res\.status === 400\) \{\s*setMode\('disabled'\)\s*\} else \{\s*setMode\('unknown'\)/)
    expect(twoFa).toMatch(/\.catch\(\(\) => setMode\('unknown'\)\)/)
    expect(twoFa).toMatch(/if \(mode === 'unknown'\)/)
  })

  it('every request has a catch', () => {
    // startEnroll, confirmEnroll, regenerate, disable — four handlers, four catches.
    expect(twoFa.match(/\} catch \{/g)?.length).toBeGreaterThanOrEqual(4)
  })
})

describe('active devices', () => {
  it('offers "sign out everywhere else", confirmed first', () => {
    expect(devices).toMatch(/fetch\('\/app\/api\/auth\/sessions', \{ method: 'POST', credentials: 'include' \}\)/)
    expect(devices).toMatch(/async function revokeEverywhereElse\(\) \{\s*const ok = await confirmToast\(/)
    expect(devices).toContain('Sign out everywhere else')
  })

  it('a single revoke confirms, handles a stale 404, and catches failures', () => {
    expect(devices).toMatch(/async function revoke\(s: DeviceSession\) \{[\s\S]*?const ok = await confirmToast\(/)
    expect(devices).toMatch(/if \(res\.status === 404\) \{[\s\S]*?await load\(\)/)
    expect(devices).toMatch(/catch \{\s*\/\/[\s\S]*?toast\.error\('Could not sign that device out — check your connection'\)/)
  })

  it('says so when it cannot tell which row is this browser', () => {
    expect(devices).toMatch(/const knowsCurrent = sessions\.some\(s => s\.current\)/)
    expect(devices).toContain('We can&apos;t tell which of these is the browser you&apos;re using')
    expect(devices).toMatch(/function looksLikeThisBrowser\(ua: string \| null\): boolean/)
  })

  it('times are on the city clock with hourCycle h23', () => {
    expect(devices).toMatch(/hourCycle: 'h23'/)
    expect(devices).not.toContain('hour12: false')
    expect(devices).toContain('exactTime(s.lastUsedAt, city?.timezone)')
  })
})

describe('accessibility', () => {
  it('toggles are switches with a name and a state', () => {
    expect(page).toMatch(/role="switch"\s*aria-checked=\{checked\}\s*aria-labelledby=\{labelId\}/)
  })

  it('password inputs are labelled', () => {
    expect(page).toContain('htmlFor="current-password"')
    expect(page).toContain('id="current-password"')
    expect(page).toContain('htmlFor="new-password"')
    expect(page).toContain('htmlFor="confirm-password"')
    expect(del).toContain('htmlFor="delete-password"')
  })

  it('a long email address cannot push the badge off a narrow screen', () => {
    expect(page).toContain('text-right break-all min-w-0')
  })
})

describe("the page doesn't collide with the mobile bottom nav", () => {
  it('/settings is not a bottom-nav route, so nothing sits under the bar', () => {
    const bottomNav = read('lib/bottomNav.ts')
    expect(bottomNav).not.toContain("'/settings'")
  })
})
