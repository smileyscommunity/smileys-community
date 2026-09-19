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
  p(`Most of our events are free, and most of them fill up. When someone holds a spot and doesn't use it, that spot could have gone to whoever was next on the waitlist. So we keep a simple record of who came.`),
  p(`<strong>The short version: turn up, or cancel in time.</strong> Do that and you will never think about this page again. Everything below is for when something goes wrong.`),

  h2(`If you weren't checked in`),
  ul([
    `<strong>The next morning, from ${NOTICE_HOUR}:00</strong>, you get a message with a tap that says <strong>"I was there"</strong>. Your host gets the same list, and can check you in.`,
    `<strong>At the end of that day</strong>, anything still unresolved is recorded as a no-show.`,
    `<strong>After that</strong>, your host can undo it for ${HOST_WINDOW} days, and you can contest it for ${DISPUTE} days.`,
  ]),
  p(`So there is a whole day, and a one-tap way out, before anything is recorded — and if that message never reached you, <strong>nothing is recorded at all</strong>. Being marked absent depends on our having actually told you in time to do something about it.`),

  h2('When nothing is recorded, whatever the roster says'),
  ul([
    `<strong>Nobody was checked in at all.</strong> If the door was never opened we have no idea who came, so the whole room is left alone.`,
    `<strong>You paid in advance.</strong> You bought the seat; missing it is your loss alone.`,
    `<strong>You took the spot late</strong> — inside ${LATE_SEAT} hours of the start, which you may never have seen in time.`,
    `<strong>A host or admin removed you.</strong>`,
    `<strong>Your spot was released</strong> because you didn't answer "Still coming?" — silence can cost you the spot, never your standing.`,
    `<strong>The event had no cap</strong> on numbers, or the city is in its first ${NEW_CITY} days.`,
  ]),

  h2('Cancelling'),
  p(`Cancel more than <strong>${CUTOFF} hours</strong> ahead and nothing is recorded — that is exactly what we want, because the spot goes to someone waiting. Inside ${CUTOFF} hours it counts the same as not coming: too late for anyone else to use.`),
  p(`This is why the "Still coming?" message arrives <strong>${ASK} hours</strong> before the event${ASK > CUTOFF ? `, comfortably before that ${CUTOFF}-hour line` : ''} — answer it honestly and you are clear either way. And if you do cancel late but someone from the waitlist takes your spot and comes, it is forgiven automatically. The rule is about the empty chair, and there wasn't one.`),

  h2('Cards'),
  ul([
    `<strong>First time in ${WINDOW} days</strong> — a message. No card.`,
    `<strong>Second</strong> — a yellow card. You join waitlists for limited events at the back.`,
    `<strong>One more after that</strong> — a red card. You can't take a spot on a limited event until it clears. Events with no cap are unaffected, and any RSVP you already hold stays valid.`,
  ]),
  p(`Cards clear by turning up: <strong>${YELLOW_CLEARS} check-ins</strong> for a yellow, <strong>${RED_CLEARS}</strong> plus an admin's review for a red. They don't expire on their own — showing up is what clears them.`),

  h2('If it is wrong'),
  p(`Tap <strong>"I was there"</strong> on the event within ${DISPUTE} days and a person looks at it. Faster still, tell your host — they were at the door, they know, and they can undo it themselves for ${HOST_WINDOW} days. Hosts are asked to be generous here: a missed scan is far likelier than someone claiming a room they weren't in.`),

  h2('Who can see it'),
  p(`Your standing is private. It is not on your profile and other members never see it. A host sees it only when you are waiting on their approval for a limited event — the one moment it is meant to matter.`),
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
