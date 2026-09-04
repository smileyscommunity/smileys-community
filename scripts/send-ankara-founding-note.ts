import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'
import { firstNameOf } from '@/lib/data'
import { writeAudit, SCRIPT_ACTOR } from '@/lib/audit'

// One-off: a personal note to the single person who asked for Ankara before
// the city existed. Draft and reasoning in docs/outreach-2026-09-first-events.md.
//
// Deliberately not the founding-member template. She is an audience of one,
// and a templated "founding member #1" mail to one person reads as automation
// pretending to be a letter. The question in the middle is the point: her
// profile neighbourhood (Maltepe) exists in both Istanbul and Ankara, so we
// genuinely do not know whether she lives there, is moving, or has ties — and
// the answer decides what is worth building next.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local \
//     scripts/send-ankara-founding-note.ts
//   ...read it, then rerun to send.
//
// Addressed by the interest row rather than a hardcoded address, so the script
// refuses rather than mailing the wrong person if that row ever moves.

const DRY_RUN = process.env.DRY_RUN === '1'
const AGAIN   = process.env.RESEND === '1'
const AUDIT   = 'city.founding_note'
const CITY    = 'ankara'

const FROM     = process.env.EMAIL_FROM ?? 'Smileys Community <info@smileyscommunity.com>'
const REPLY_TO = process.env.OUTREACH_REPLY_TO ?? 'yamanerim@gmail.com'
const SUBJECT  = 'Ankara is open — and you asked first'

const esc = (s: string) => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!))

const LINES = (first: string) => [
  `Hi ${first},`,
  'Ankara went live this week, and you’re the only person who asked for it before it existed. That earns you a real email rather than an announcement.',
  'There are eighteen neighbourhoods mapped, fifteen places worth going written up, and a guide to the Başkentkart that took an embarrassing amount of research. What there isn’t yet is a single event, because a city becomes real the first time two people who met here have coffee.',
  'Can I ask what your Ankara actually is? Do you live there, are you moving, or is it family and old friends? It changes what would be useful to build.',
  'And if you’d ever want to start the first thing — a coffee in Kızılay, a walk somewhere in Hamamönü, whatever you’d actually turn up to — say the word and I’ll set it up around you.',
  'Nate',
]

function html(first: string): string {
  const p = 'color:#374151;font-size:15px;line-height:1.65;margin:0 0 16px'
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">`
    + LINES(esc(first)).map(l => `<p style="${p}">${l}</p>`).join('')
    + `</div>`
}
const text = (first: string) => LINES(first).join('\n\n')

async function main() {
  const city = await prisma.city.findUnique({ where: { slug: CITY }, select: { id: true, name: true } })
  if (!city) throw new Error(`City not found: ${CITY}`)

  const prior = await prisma.auditLog.findFirst({ where: { action: AUDIT, targetId: city.id }, select: { createdAt: true } })
  if (prior && !AGAIN && !DRY_RUN) {
    console.error(`✗ already sent ${prior.createdAt.toISOString()} — RESEND=1 to send again`)
    process.exit(1)
  }

  // The people who put themselves on this city's list before it launched.
  const rows = await prisma.cityRelationship.findMany({
    where:  { cityId: city.id, type: 'interested' },
    select: { user: { select: { id: true, name: true, email: true } }, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  if (rows.length === 0) { console.error('✗ nobody on the Ankara interest list — nothing to send'); process.exit(1) }
  if (rows.length > 1) {
    console.error(`✗ ${rows.length} people on the list, but this letter is written for one — rewrite it before sending`)
    for (const r of rows) console.error(`   ${r.user.name} <${r.user.email}>`)
    process.exit(1)
  }

  const to = rows[0].user
  const first = firstNameOf(to.name)
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}${SUBJECT}`)
  console.log(`  from ${FROM}   reply-to ${REPLY_TO}`)
  console.log(`  to ${to.name} <${to.email}> — on the ${city.name} list since ${rows[0].createdAt.toISOString().slice(0, 10)}\n`)
  console.log(text(first))

  if (DRY_RUN) { console.log('\n[DRY RUN] nothing sent'); return }

  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY missing')
  const res = await new Resend(key).emails.send({
    from: FROM, to: to.email, replyTo: REPLY_TO,
    subject: SUBJECT, html: html(first), text: text(first),
  })
  if (res.error) throw new Error(JSON.stringify(res.error))

  await writeAudit(SCRIPT_ACTOR.id, SCRIPT_ACTOR.name, AUDIT, city.id, 'city',
    { city: city.name, to: to.email, subject: SUBJECT },
    `Founding note to ${to.name} in ${city.name}`,
  )
  console.log(`\n✓ sent to ${to.email}`)
}

main().finally(() => prisma.$disconnect())
