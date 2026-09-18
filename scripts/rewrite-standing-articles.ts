// Rewrite the member-facing standing article, and re-date both policy
// articles so the list shows when they were actually corrected.
//
// The published version described v1 throughout: a card on the first
// no-show, a yellow that "expires automatically", a red card that pauses
// RSVPs for 30 days with a 48-hour appeal, a 12-hour cancellation line, and
// an event skipped entirely unless the host scanned enough of the room.
// None of that is true. v1's cards were all reversed on 15 September.
//
// Every number is read from the policy modules at render time, so re-running
// this after a constants change republishes a correct article. The host guide
// has its own generator (rewrite-host-guide.ts); only the dates are shared.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/rewrite-standing-articles.ts
import { prisma } from '@/lib/prisma'
import {
  STANDING_WINDOW_DAYS as WINDOW, YELLOW_CLEARS_AT_COMMITMENTS as YELLOW_CLEARS,
  RED_REVIEW_AT_ATTENDANCES as RED_CLEARS, DISPUTE_WINDOW_DAYS as DISPUTE,
  HOST_MARKING_WINDOW_DAYS as HOST_WINDOW, LATE_SEAT_HOURS as LATE_SEAT,
  CANCEL_CUTOFF_HOURS, ATTENDANCE_REVIEW_NOTICE_HOUR as NOTICE_HOUR,
  NEW_CITY_GRACE_DAYS as NEW_CITY,
} from '@/lib/standingPolicy'
import { RECONFIRM_ASK_HOURS_BEFORE as ASK, RECONFIRM_RELEASE_HOURS_BEFORE as RELEASE } from '@/lib/noShowPolicy'

const DRY    = process.env.DRY_RUN === '1'
const MEMBER = 'how-free-event-spots-work'
const HOST   = 'how-no-show-cards-work-for-hosts'
const CUTOFF = CANCEL_CUTOFF_HOURS.scarce

const TITLE = 'How free-event spots work, and what counts as a no-show'

const EXCERPT = `Most of our events are free and many fill up, so a spot nobody uses is a spot someone on the waitlist wanted. Here is exactly what is recorded, what isn't, and how to stay clear of all of it — the short version being: turn up, or cancel in time.`

const p  = (t: string) => `<p>${t}</p>`
const h2 = (t: string) => `<h2>${t}</h2>`
const ul = (items: string[]) => `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`

const BODY = [
  p(`Most of our events are free, and many of them fill up. When someone books a spot and doesn't use it, that spot could have gone to someone on the waitlist. So events with <strong>limited spots</strong> keep a simple record of who came. Here is all of it, so nothing is a surprise.`),
  p(`The short version: <strong>turn up, or cancel in time</strong>. That is the whole thing. Everything below is detail for the cases where something goes wrong.`),

  h2('What actually happens'),
  ul([
    `Your host checks people in at the event.`,
    `If you weren't checked in, you get a message <strong>the next morning, from ${NOTICE_HOUR}:00</strong>, with a tap that says <strong>"I was there"</strong>. Your host gets the same list and can check you in or set it aside.`,
    `<strong>At the end of that day</strong>, anything still unresolved is recorded as a no-show.`,
    `Your host can undo it for <strong>${HOST_WINDOW} days</strong> afterwards, and you can contest it for <strong>${DISPUTE} days</strong>.`,
  ]),
  p(`And if we never sent you that message, <strong>nothing is recorded</strong>. Being marked absent depends on our having actually told you, in time to do something about it. That part is on us.`),

  h2('What is never recorded'),
  ul([
    `Events with <strong>no cap on numbers</strong>. Only limited-spot events count.`,
    `Anything you <strong>paid for in advance</strong>. You bought the seat; missing it is your loss alone.`,
    `A spot you took <strong>less than ${LATE_SEAT} hours</strong> before the start.`,
    `A spot a <strong>host or admin</strong> removed you from.`,
    `A spot <strong>released because you didn't answer "Still coming?"</strong> — silence can cost you the spot, never your standing.`,
    `Events in a city's <strong>first ${NEW_CITY} days</strong>.`,
  ]),

  h2('Cancelling'),
  p(`Cancel more than <strong>${CUTOFF} hours</strong> before a limited event and nothing is recorded — that is exactly what we want, because it gives the spot to someone waiting. Inside ${CUTOFF} hours it counts the same as not coming: too late for anyone else to take it. Two things clear that automatically:`),
  ul([
    `Someone from the waitlist takes your spot <em>and comes</em>. No empty chair, nothing recorded.`,
    `You answered the day-before "Still coming?" with a no, before the spot was released (<strong>${RELEASE} hours</strong> before the start). Telling us straight is never punished.`,
  ]),

  h2('What a card is'),
  ul([
    `<strong>The first time in ${WINDOW} days: nothing but a message.</strong> No card.`,
    `<strong>The second: a yellow card.</strong> You join waitlists for limited events at the back.`,
    `<strong>One more after that: a red card.</strong> You can't take a spot on an event with limited places until it's cleared. Events with no cap are unaffected — and they are how you clear it. Any RSVP you already hold stays valid.`,
  ]),
  p(`Cards are cleared by turning up: <strong>${YELLOW_CLEARS} check-ins</strong> clears a yellow, <strong>${RED_CLEARS}</strong> clears a red once an admin has reviewed it. A card does not expire on its own — showing up is what clears it.`),

  h2('If it is wrong'),
  p(`Tap <strong>"I was there"</strong> on the event within ${DISPUTE} days and a human looks at it. Faster still: tell your host. They were at the door, they know, and they can undo it themselves for ${HOST_WINDOW} days. Hosts are asked to be generous about this — a missed scan is far more likely than someone lying about being in the room.`),

  h2('"Still coming?"'),
  p(`Limited free events send a message about <strong>${ASK} hours</strong> before asking whether you are still coming. Tap yes and you're set. If you don't answer <em>and someone is waiting</em>, your spot goes to them <strong>${RELEASE} hours</strong> before the start. If nobody is waiting, your spot stays yours. Either way it is never a no-show, and you can rejoin the waitlist.`),

  h2('Who can see it'),
  p(`Your standing is private. It is not on your profile and other members never see it. A host sees it only when you are waiting for their approval on a limited event — which is the one moment it is meant to matter.`),
  p(`You can always check yours at <a href="/standing">Standing</a>. If there is nothing on record, that is exactly what it will say.`),

  p(`Thanks for helping keep Smileys events full of people who actually want to be there. ❤️`),
].join('\n\n')

async function main() {
  const post = await prisma.post.findUnique({ where: { slug: MEMBER }, select: { id: true, body: true } })
  if (!post) throw new Error(`no post ${MEMBER}`)
  console.log('--- TITLE ---\n' + TITLE)
  console.log('\n--- BODY (tags stripped) ---\n' + BODY.replace(/<li>/g, '\n  • ').replace(/<h2>/g, '\n\n## ').replace(/<[^>]*>/g, ''))
  console.log(`\n--- old ${post.body.length} chars, new ${BODY.length} ---`)
  if (DRY) { console.log('DRY RUN — nothing written'); return }
  const now = new Date()
  await prisma.post.update({ where: { id: post.id }, data: { title: TITLE, excerpt: EXCERPT, body: BODY, publishedAt: now } })
  // Both articles were corrected today; the host guide's body was rewritten by
  // its own script, but its date still said 3 September.
  const host = await prisma.post.update({ where: { slug: HOST }, data: { publishedAt: now } }).catch(() => null)
  console.log('member updated; host re-dated:', !!host)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
