// Rewrite the host guide for standing v2 (2026-09-19).
//
// The published version describes v1: a 50% check-in gate, a card on the first
// absence, a 48-hour appeal, a "No-shows tab". None of that exists. Every
// number here is read from lib/standingPolicy so the article cannot drift from
// the code again.
//
// notifiedAt is already set on this post, so no broadcast fires (notifyNewArticle
// only claims a null notifiedAt). Editing it is silent, as it should be — this
// is a correction, not an announcement.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/rewrite-host-guide.ts
import { prisma } from '@/lib/prisma'
import {
  STANDING_WINDOW_DAYS as WINDOW, YELLOW_AFTER_OFFENCES as YELLOW_AT,
  YELLOW_CLEARS_AT_COMMITMENTS as YELLOW_CLEARS, RED_REVIEW_AT_ATTENDANCES as RED_CLEARS,
  DISPUTE_WINDOW_DAYS as DISPUTE, HOST_MARKING_WINDOW_DAYS as HOST_WINDOW,
  LATE_SEAT_HOURS as LATE_SEAT, CANCEL_CUTOFF_HOURS, ATTENDANCE_REVIEW_NOTICE_HOUR as NOTICE_HOUR,
  NEW_CITY_GRACE_DAYS as NEW_CITY,
} from '@/lib/standingPolicy'
import { RECONFIRM_ASK_HOURS_BEFORE as ASK, RECONFIRM_RELEASE_HOURS_BEFORE as RELEASE } from '@/lib/noShowPolicy'

const DRY  = process.env.DRY_RUN === '1'
const SLUG = 'how-no-show-cards-work-for-hosts'
const CUTOFF = CANCEL_CUTOFF_HOURS.scarce

const TITLE = 'How attendance works on your events — a guide for hosts'

const EXCERPT = `You check people in; anyone unchecked hears from us the next morning and can say "I was there". Nothing counts against them unless that message reached them, and you can correct any of it for ${HOST_WINDOW} days. Here is the whole system from the host's side.`

const p  = (t: string) => `<p>${t}</p>`
const h2 = (t: string) => `<h2>${t}</h2>`
const ul = (items: string[]) => `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`

const BODY = [
  p(`Your job is one thing: <strong>check people in at the door</strong>. Everything below follows from that, and none of it asks you to be the person who penalises anyone.`),

  h2('What happens, and when'),
  ul([
    `<strong>At the door</strong> — you check people in. Scan everyone who turns up, including latecomers.`,
    `<strong>The next morning, from ${NOTICE_HOUR}:00 your city's time</strong> — you get a list of everyone who wasn't checked in. Each of them gets their own message at the same time, with a tap to say "I was there".`,
    `<strong>The end of that day</strong> — anyone still on the list counts as a no-show. <strong>Anyone whose message never reached them does not</strong>: they settle as attended, whatever the roster says.`,
    `<strong>For ${HOST_WINDOW} days afterwards</strong> — you can still <strong>waive</strong> an absence, or mark one you missed. A fresh check-in is refused once the room has settled, so to fix a missed scan, waive it rather than trying to scan them late.`,
  ]),
  p(`There is no threshold any more. It used to be that if fewer than half the room was scanned, the whole event was skipped and nothing counted. That protected members from bad data, but it also meant that at a thinly-scanned event <em>nobody</em> was ever recorded — so the same behaviour counted at one event and not at another. What protects members now is the message: nobody is marked absent on a warning they never received.`),
  p(`One line does remain, and it is about you rather than them: <strong>if you never check anyone in, nothing is recorded for anyone</strong>. No scans is not evidence that nobody came — it is evidence that nobody checked, and a room where the door never opened is not one we will guess about. You still get the list, and you can still mark whoever genuinely didn't turn up.`),

  h2('What never counts'),
  ul([
    `A seat taken <strong>less than ${LATE_SEAT} hours</strong> before the start — a waitlist spot or a late join someone may not have seen in time.`,
    `Events with <strong>no cap on numbers</strong>. Attendance is recorded, but it never affects anyone's standing. Only limited-spot events count.`,
    `<strong>You and your co-hosts</strong>, your club's hosts, and staff. Never.`,
    `A city in its <strong>first ${NEW_CITY} days</strong> — recorded, but nothing counts against anyone yet.`,
    `A seat released because someone didn't answer "Still coming?" — that is never an absence.`,
    `Anything at an event where <strong>nobody was scanned</strong> — see above.`,
    `A seat someone <strong>paid for in advance</strong>. They bought it; missing it is their loss alone.`,
  ]),

  h2('Cancelling late counts too'),
  p(`On a limited event, cancelling inside <strong>${CUTOFF} hours</strong> of the start costs the same as not coming: the seat is too late for anyone else to take. Two things clear it, both automatic — you don't have to do anything:`),
  ul([
    `If someone from the waitlist takes the seat <em>and turns up</em>, the late cancel is forgiven — the harm the rule prices is the empty chair, and there wasn't one.`,
    `Answering the day-before "Still coming?" with a no is on time, as long as it comes before the seats are released — <strong>${RELEASE} hours</strong> before the start. Nobody is penalised for telling you straight.`,
  ]),

  h2('The cards'),
  ul([
    `<strong>First absence in ${WINDOW} days: a message, no card.</strong>`,
    `<strong>${YELLOW_AT === 2 ? 'Second' : `${YELLOW_AT}th`}: a yellow card.</strong> They join limited waitlists at the back.`,
    `<strong>One more while the yellow is live: a red card.</strong> They can't take a spot on a limited event until it's cleared. You are not asked to turn anyone away — the system does it, and events with no cap stay open to them.`,
  ]),
  p(`Cards are cleared by turning up and by nothing else. A yellow goes after <strong>${YELLOW_CLEARS} check-ins</strong> at any event; a red needs <strong>${RED_CLEARS}</strong>, then an admin reviews it. A card does not expire by waiting, and hosting or volunteering does not buy one off — those are counted and shown, but the card is about turning up, so turning up is what clears it.`),
  p(`Anyone marked absent by mistake can tap <strong>"I was there"</strong> within ${DISPUTE} days, which sends it to an admin. You can also just fix it yourself, which is faster for everyone.`),

  h2('Where to look'),
  ul([
    `<strong>Attendance review</strong> — every one of your events still open for correction: who wasn't checked in, who was actually told, and how long you have. This is the page to check the morning after.`,
    `<strong>Check-in</strong> — the same screen you use at the door. Check someone in late, waive an absence, or add a walk-in.`,
  ]),

  h2('The day-before "Still coming?"'),
  p(`Limited free events ask attendees to reconfirm about <strong>${ASK} hours</strong> before the start${ASK > CUTOFF ? ` — deliberately earlier than the ${CUTOFF}-hour cutoff, so anyone who answers "no" is still clear of it` : ''}. If nobody answers and somebody is waiting, the unanswered seat goes to the waitlist <strong>${RELEASE} hours</strong> before you start. So expect a few seats to move the day before — that is the system working, not a problem. A released member is told, can rejoin, and is never recorded as absent for it.`),

  h2('What we ask of you'),
  ul([
    `<strong>Scan everyone.</strong> A missed scan is the only way someone who came ends up on the list.`,
    `<strong>Read the morning list.</strong> It takes a few seconds and it is the moment the record is still soft.`,
    `<strong>Waive generously.</strong> If you think they were there, they were there. You know the room; the roster doesn't.`,
  ]),

  h2('What members were told'),
  p(`Members have their own page for this: <a href="/standing">Standing</a> explains what a card means and how to clear one. If someone asks you about an absence, that is the page to send them to.`),
  p(`Something looks wrong, or a card you believe is unfair? Message Nate.`),
].join('\n\n')

async function main() {
  const post = await prisma.post.findUnique({ where: { slug: SLUG }, select: { id: true, title: true, body: true } })
  if (!post) throw new Error(`no post ${SLUG}`)
  console.log('--- TITLE ---\n' + TITLE)
  console.log('\n--- EXCERPT ---\n' + EXCERPT)
  console.log('\n--- BODY (tags stripped) ---\n' + BODY.replace(/<li>/g, '\n  • ').replace(/<h2>/g, '\n\n## ').replace(/<[^>]*>/g, ''))
  console.log(`\n--- old body ${post.body.length} chars, new ${BODY.length} chars ---`)
  if (DRY) { console.log('DRY RUN — nothing written'); return }
  await prisma.post.update({ where: { id: post.id }, data: { title: TITLE, excerpt: EXCERPT, body: BODY } })
  console.log('updated')
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
