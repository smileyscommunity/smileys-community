// The host-side no-show briefing — a one-off, sent to every approved club host.
// Content: docs/no-show-announcement.draft.md §2. Separate from the member
// article on purpose: hosts are the only people who can clear a card, and the
// half-the-room rule only means something to whoever is holding the scanner.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/notify-hosts-no-show.ts
//
// Idempotent via a marker row in audit_logs: a second run reports how many
// hosts were already briefed and sends nothing. To deliberately re-send,
// delete the marker (action='host_no_show_briefing').
//
// Operational, not marketing: it goes to every host regardless of newsletter
// preference, because it describes something their role now requires of them.
// That is also why it does NOT reuse sendBroadcastEmail — that helper ends
// every message with "Browse upcoming events →" and a newsletter unsubscribe,
// both wrong for a briefing about a host's own duties, and it escapes the body
// so an inline link would render as dead text. The send is inlined here rather
// than added to lib/email.ts so this one-off needs no deploy.
import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'
import { firstNameOf } from '@/lib/data'
import {
  NO_SHOW_CANCELLATION_CUTOFF_HOURS as CUTOFF,
  NO_SHOW_ROLLING_WINDOW_DAYS as WINDOW,
  RED_CARD_BLOCK_DAYS as BLOCK,
  RED_CARD_APPEAL_WINDOW_HOURS as APPEAL,
  NO_SHOW_PROCESSING_DELAY_HOURS as DELAY,
  NO_SHOW_MIN_CHECKIN_RATIO as RATIO,
  RECONFIRM_ASK_HOURS_BEFORE as ASK,
  NO_SHOW_POLICY_PATH,
} from '@/lib/noShowPolicy'

const DRY_RUN = process.env.DRY_RUN === '1'
const MARKER  = 'host_no_show_briefing'
const SHARE   = `${Math.round(RATIO * 100)}%`

const SUBJECT = 'How no-show cards work on your events'

const APP_URL   = process.env.NEXT_PUBLIC_APP_URL ?? 'https://smileyscommunity.com/app'
const FROM      = process.env.EMAIL_FROM ?? 'Smileys Community <info@smileyscommunity.com>'
// The member article — what the CTA is explicitly labelled as ("what members
// were told"). The notification link is the HOST guide; see HOST_GUIDE below.
const ARTICLE    = `${APP_URL}${NO_SHOW_POLICY_PATH}`
const HOST_GUIDE = '/posts/how-no-show-cards-work-for-hosts'

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const h2 = (t: string) => `<h2 style="font-size:15px;font-weight:800;color:#111827;margin:24px 0 8px">${t}</h2>`
const p  = (t: string) => `<p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.65">${t}</p>`

/** The briefing, as HTML. Every number comes from lib/noShowPolicy. */
function bodyHtml(firstName: string): string {
  return [
    p(`Hi ${esc(firstName)},`),
    p(`Free events now settle no-shows automatically. Here is the whole system from your side, because <strong>you are the only person who can clear a card</strong>.`),

    h2('When cards are issued'),
    p(`About ${DELAY} hours after your event ends, if you ran check-in for at least ${SHARE} of the room, every confirmed attendee who neither checked in nor cancelled ${CUTOFF} hours before the start gets a card. The first one in ${WINDOW} days is yellow — a warning. The second is red: RSVPs pause for ${BLOCK} days, after a ${APPEAL}-hour window to appeal. Paid events are never processed.`),

    h2(`Why the ${SHARE} rule matters`),
    p(`If you only scanned a few people, the system assumes the door stopped scanning — not that everyone else stayed home — and issues nothing at all. So <strong>scan everyone who walks in</strong>. Missed scans are the main way a good member ends up with a card they did not earn.`),

    h2('What you see'),
    p(`A notification and an email when cards are issued for your event, with the count. A <strong>No-shows tab</strong> on your event's participants page listing every card from that event. And on the approval queue, a small 🟨 next to anyone holding an active card — a count, not a history, and only while a card is active.`),

    h2('What you control'),
    p(`You can <strong>clear a card</strong> from the No-shows tab. Use it whenever someone was actually there: arrived late, scan missed, you know they came. Say why — it goes in the audit log — and the member is told the card no longer counts. A card you clear never counts toward a red one.`),
    p(`Nothing else. Cards are issued by the system and appeals go to admins. <strong>You never have to be the person who penalises anyone.</strong>`),

    h2('The day-before reconfirmation'),
    p(`Free events with limited spots ask attendees "still coming?" about ${ASK} hours ahead. Anyone who does not answer loses the seat to the waitlist ${CUTOFF} hours before the start — but only if somebody is actually waiting. Expect a few seats to move overnight; that is the system working.`),

    h2('What it asks of you'),
    p(`<strong>1.</strong> Run check-in properly, every time, for everyone who arrives.<br>
       <strong>2.</strong> If you finish scanning the morning after, that is fine — the sweep waits for you.<br>
       <strong>3.</strong> Clear cards for late arrivals and missed scans as soon as you notice.`),
  ].join('')
}

function emailHtml(firstName: string): string {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:40px 32px;border:1px solid #e5e7eb">
      <div style="margin-bottom:24px">
        <p style="margin:0;font-size:14px;color:#6b7280;white-space:nowrap"><span style="font-size:26px;vertical-align:-5px">😊</span>&nbsp;<strong style="color:#374151">Smileys&nbsp;Community</strong> &nbsp;·&nbsp; <span style="color:#9ca3af">for hosts</span></p>
      </div>
      <h1 style="font-size:20px;font-weight:800;color:#111827;margin:0 0 20px">How no-show cards work on your events</h1>
      ${bodyHtml(firstName)}
      <div style="margin-top:28px;padding-top:20px;border-top:1px solid #f3f4f6">
        <a href="${ARTICLE}" style="display:inline-block;background:#f59e0b;color:#fff;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;text-decoration:none">
          Read what members were told →
        </a>
      </div>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;line-height:1.6">
        You're getting this because you host events on Smileys — it explains something your role now involves, so it isn't part of the newsletter you can mute.<br>
        Questions, or a card you think is wrong: just reply to this email.
      </p>
    </div>`
}

async function main() {
  const already = await prisma.auditLog.findFirst({ where: { action: MARKER }, select: { createdAt: true } })
  if (already) { console.log(`✓ hosts were briefed on ${already.createdAt.toISOString()} — nothing to do`); return }

  const actor = await prisma.user.findFirst({
    where:  { name: 'Nate G.', role: { in: ['admin', 'moderator'] } },
    select: { id: true, name: true },
  })
  if (!actor) throw new Error('Actor "Nate G." not found')

  const hosts = await prisma.user.findMany({
    where: {
      status: 'approved',
      clubMemberships: { some: { role: 'host', status: 'approved' } },
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  })

  console.log(`→ brief ${hosts.length} approved club hosts`)
  console.log(`  subject  ${SUBJECT}`)
  if (DRY_RUN) {
    console.log('\n  DRY RUN — nothing sent\n')
    console.log(hosts.map(h => `    ${h.name} <${h.email}>`).join('\n'))
    const sample = emailHtml('Alessandra')
    console.log(`\n  ── email as it renders (tags stripped) ──\n`)
    console.log(sample.replace(/<h[12][^>]*>/g, '\n## ').replace(/<\/h[12]>/g, '\n')
      .replace(/<br\s*\/?>/g, '\n').replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n').replace(/^[ \t]+/gm, '').trim())
    console.log(`\n  CTA → ${ARTICLE}`)
    return
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  let sent = 0
  const failed: string[] = []
  for (const h of hosts) {
    try {
      await createNotification(
        h.id, 'broadcast',
        '🟨 How no-show cards work on your events',
        'Free events now settle no-shows automatically. You are the only person who can clear a card — here is what that means at your door.',
        HOST_GUIDE,
      )
      await resend.emails.send({
        from: FROM, to: h.email,
        subject: SUBJECT,
        html: emailHtml(firstNameOf(h.name) || 'there'),
        tags: [{ name: 'type', value: 'host_no_show_briefing' }],
      })
      sent++
    } catch (e) {
      console.error(`  ✗ ${h.email}`, String(e))
      failed.push(h.email)
    }
  }

  // Marker last: a crash mid-run leaves it unset, and the operator can clear
  // the already-sent hosts by hand rather than the script silently claiming
  // a briefing that only half happened.
  await writeAudit(
    actor.id, actor.name ?? 'system', MARKER, undefined, undefined,
    { sent, total: hosts.length, failed },
    `No-show host briefing sent to ${sent}/${hosts.length} hosts${failed.length ? ` (failed: ${failed.join(', ')})` : ''}`,
  )
  console.log(`✓ ${sent}/${hosts.length} briefed${failed.length ? `, ${failed.length} failed` : ''}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
