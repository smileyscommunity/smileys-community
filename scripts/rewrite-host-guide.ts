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
  p(`Your part is simple: <strong>check people in at the door</strong>. Everything below follows from that — and none of it asks you to judge anyone, argue with anyone, or hand out a penalty yourself. Scan people in, and the rest takes care of itself.`),

  h2('The three things that matter'),
  ul([
    `<strong>Scan everyone who turns up</strong>, latecomers included. A missed scan is the only way somebody who came ends up on a list.`,
    `<strong>Glance at the list the next morning.</strong> It takes seconds, and it is the moment the record is still soft.`,
    `<strong>Be generous.</strong> If you think they were there, they were there. You know the room; the roster doesn't.`,
  ]),

  h2('What happens, and when'),
  ul([
    `<strong>At the door</strong> — you check people in.`,
    `<strong>Next morning, from ${NOTICE_HOUR}:00</strong> — you get a list of anyone who wasn't checked in. They each get their own message too, with a tap that says "I was there".`,
    `<strong>End of that day</strong> — anyone still on the list is recorded as a no-show.`,
    `<strong>For ${HOST_WINDOW} days after</strong> — you can still waive an absence, or mark one you missed.`,
  ]),
  p(`To fix a missed scan after that first day, <strong>waive it</strong> rather than trying to check them in late — the door closes once the room settles, but waiving stays open for the full month.`),

  h2('Two things that protect your members'),
  p(`<strong>Nobody is marked absent without being told.</strong> If that morning message never reached them, their seat settles as attended, whatever the roster says. Being recorded depends on us having actually warned them in time to do something about it.`),
  p(`<strong>If you never check anyone in, nothing is recorded for anyone.</strong> No scans isn't evidence that nobody came — it's evidence that nobody checked, and we won't guess about a room whose door never opened. You still get the list, and you can still mark whoever genuinely didn't turn up.`),

  h2(`What never counts against anyone`),
  ul([
    `Events with <strong>no cap on numbers</strong> — attendance is recorded, but it never touches anyone's standing.`,
    `A seat someone <strong>paid for in advance</strong>. They bought it; missing it is their loss alone.`,
    `A seat taken <strong>less than ${LATE_SEAT} hours</strong> before the start — a late waitlist spot they may never have seen.`,
    `A seat <strong>released</strong> because they didn't answer "Still coming?".`,
    `<strong>You, your co-hosts, your club's hosts and staff.</strong> Never.`,
    `Anything in a city's <strong>first ${NEW_CITY} days</strong> — recorded, but nothing counts yet.`,
  ]),

  h2('Cancelling late counts too'),
  p(`On a limited event, cancelling inside <strong>${CUTOFF} hours</strong> of the start costs the same as not coming — the seat is too late for anyone else to use. Two things clear it automatically, so you needn't do anything:`),
  ul([
    `Someone from the waitlist takes the seat <em>and comes</em>. No empty chair, nothing recorded.`,
    `They answered the day-before "Still coming?" with a no, before the seats were released. Nobody is penalised for telling you straight.`,
  ]),

  h2('The cards'),
  ul([
    `<strong>First absence in ${WINDOW} days</strong> — a message, no card.`,
    `<strong>${YELLOW_AT === 2 ? 'Second' : `${YELLOW_AT}th`}</strong> — a yellow card. They join limited waitlists at the back.`,
    `<strong>One more after that</strong> — a red card. They can't take a limited spot until it clears. You are never asked to turn anyone away, and events with no cap stay open to them.`,
  ]),
  p(`Cards clear by turning up: <strong>${YELLOW_CLEARS} check-ins</strong> for a yellow, <strong>${RED_CLEARS}</strong> plus an admin's review for a red. They don't expire on their own, and hosting or volunteering doesn't buy one off — showing up is what the card is about, so showing up is what clears it.`),

  h2('If something looks wrong'),
  p(`Fix it yourself — that's fastest, and it's what the ${HOST_WINDOW}-day window is for. A member can also tap <strong>"I was there"</strong> within ${DISPUTE} days, which sends it to an admin.`),

  h2('Where to look'),
  ul([
    `<strong>Attendance review</strong> — your events still open for correction: who wasn't checked in, who was told, and how long you have. This is the page for the morning after.`,
    `<strong>Check-in</strong> — the screen you use at the door. Check someone in, waive an absence, or add a walk-in.`,
  ]),

  h2('About that "Still coming?" message'),
  p(`Limited free events ask attendees to confirm about <strong>${ASK} hours</strong> ahead${ASK > CUTOFF ? `, deliberately earlier than the ${CUTOFF}-hour cutoff so anyone answering "no" is still clear of it` : ''}. If they don't answer and somebody is waiting, the seat passes to the waitlist <strong>${RELEASE} hours</strong> before you start. A few seats moving the day before is the system working, not a problem — whoever lost theirs is told, can rejoin, and is never recorded as absent for it.`),

  p(`Members have their own version of all this at <a href="/standing">Standing</a> — that's the page to send anyone who asks. Anything here look wrong? Message Nate.`),
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
