import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'
import { firstNameOf } from '@/lib/data'
import { writeAudit, SCRIPT_ACTOR } from '@/lib/audit'

// One-off: the "first coffee in Kaleiçi" note to Smileys Antalya's founding
// members. Draft and reasoning in docs/outreach-2026-09-first-events.md.
//
// Antalya has fifteen approved members and has never held an event. The ask is
// deliberately two questions — would you come, and do you know the place —
// because the second one turns a member into the host the city doesn't have.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local \
//     scripts/send-antalya-first-event.ts
//   ...read the rendered mail and the recipient list, then rerun to send.
//
// ONE RECIPIENT PER SEND. Fifteen strangers must not see each other's
// addresses, and a member who replies must reach a person, so replyTo is the
// owner's own inbox rather than the no-reply From.
//
// Idempotent by audit row: a second run refuses unless RESEND=1, so a
// half-finished run can be inspected before anything is repeated.

const DRY_RUN = process.env.DRY_RUN === '1'
const AGAIN   = process.env.RESEND === '1'
const AUDIT   = 'city.first_event_outreach'
const CITY    = 'antalya'
const OWNER   = 'nate@smileyscommunity.com'

const FROM     = process.env.EMAIL_FROM ?? 'Smileys Community <info@smileyscommunity.com>'
const REPLY_TO = process.env.OUTREACH_REPLY_TO ?? 'yamanerim@gmail.com'
const SUBJECT  = 'Antalya, a first coffee — who’s around?'

const esc = (s: string) => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!))

function html(firstName: string): string {
  const p = 'color:#374151;font-size:15px;line-height:1.65;margin:0 0 16px'
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
    <p style="${p}">Hi ${esc(firstName)},</p>
    <p style="${p}">You’re one of the first fifteen people in Smileys Antalya, which is a strange and good place to be: everything here is still unwritten.</p>
    <p style="${p}">I’d like to fix the obvious gap. There’s a city guide, there are clubs, and there has not yet been a single evening where any of you were in the same room. That’s the only thing that actually matters.</p>
    <p style="${p}">So: a first coffee or dinner in Kaleiçi, one evening in the next two weeks. Four of you are in Kaleiçi already and four more are twenty minutes away in Konyaaltı.</p>
    <p style="${p}">Two questions, and a one-line reply is a complete answer:</p>
    <ol style="${p};padding-left:20px">
      <li style="margin-bottom:6px">Would you come?</li>
      <li>Do you know the right place — somewhere with a table for eight that won’t mind us talking for three hours?</li>
    </ol>
    <p style="${p}">If you know the place, you’re the person to pick it, and I’ll back you. That’s how every Smileys city has started, Istanbul included.</p>
    <p style="${p}">Nate</p>
  </div>`
}

function text(firstName: string): string {
  return [
    `Hi ${firstName},`, '',
    'You’re one of the first fifteen people in Smileys Antalya, which is a strange and good place to be: everything here is still unwritten.', '',
    'I’d like to fix the obvious gap. There’s a city guide, there are clubs, and there has not yet been a single evening where any of you were in the same room. That’s the only thing that actually matters.', '',
    'So: a first coffee or dinner in Kaleiçi, one evening in the next two weeks. Four of you are in Kaleiçi already and four more are twenty minutes away in Konyaaltı.', '',
    'Two questions, and a one-line reply is a complete answer:', '',
    '  1. Would you come?',
    '  2. Do you know the right place — somewhere with a table for eight that won’t mind us talking for three hours?', '',
    'If you know the place, you’re the person to pick it, and I’ll back you. That’s how every Smileys city has started, Istanbul included.', '',
    'Nate',
  ].join('\n')
}

async function main() {
  const city = await prisma.city.findUnique({ where: { slug: CITY }, select: { id: true, name: true } })
  if (!city) throw new Error(`City not found: ${CITY}`)

  const prior = await prisma.auditLog.findFirst({ where: { action: AUDIT, targetId: city.id }, select: { createdAt: true } })
  if (prior && !AGAIN && !DRY_RUN) {
    console.error(`✗ already sent ${prior.createdAt.toISOString()} — RESEND=1 to send again`)
    process.exit(1)
  }

  const members = await prisma.user.findMany({
    where:   { cityId: city.id, status: 'approved' },
    select:  { id: true, name: true, email: true },
    orderBy: { joinedAt: 'asc' },
  })
  // The owner gets the same mail, so what members received is in his inbox too.
  const owner = await prisma.user.findFirst({ where: { email: OWNER }, select: { id: true, name: true, email: true } })
  const recipients = owner && !members.some(m => m.email === owner.email) ? [...members, owner] : members

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}${SUBJECT}`)
  console.log(`  from ${FROM}   reply-to ${REPLY_TO}`)
  console.log(`  ${members.length} Antalya members${owner ? ' + the owner’s own copy' : ''} = ${recipients.length} sends, one recipient each\n`)
  for (const r of recipients) console.log(`   ${r.email === OWNER ? '(copy) ' : '       '}${firstNameOf(r.name).padEnd(12)} ${r.email}`)

  if (DRY_RUN) {
    console.log('\n--- plain text as one member sees it ---\n')
    console.log(text(firstNameOf(recipients[0].name)))
    console.log('\n[DRY RUN] nothing sent')
    return
  }

  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY missing')
  const resend = new Resend(key)

  const sent: string[] = [], failed: { email: string; error: string }[] = []
  for (const r of recipients) {
    const first = firstNameOf(r.name)
    try {
      const res = await resend.emails.send({
        from: FROM, to: r.email, replyTo: REPLY_TO,
        subject: SUBJECT, html: html(first), text: text(first),
      })
      if (res.error) throw new Error(JSON.stringify(res.error))
      sent.push(r.email)
      console.log(`  ✓ ${r.email}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failed.push({ email: r.email, error: msg })
      console.error(`  ✗ ${r.email} — ${msg}`)
    }
    // Resend's default rate limit is 2/sec; stay well under it.
    await new Promise(res => setTimeout(res, 600))
  }

  await writeAudit(SCRIPT_ACTOR.id, SCRIPT_ACTOR.name, AUDIT, city.id, 'city',
    { city: city.name, sent: sent.length, failed: failed.length, subject: SUBJECT, failures: failed.slice(0, 10) },
    `First-event outreach to ${sent.length} member(s) in ${city.name}`,
  )
  console.log(`\n✓ sent ${sent.length}${failed.length ? `, ${failed.length} failed` : ''}`)
  if (failed.length) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
