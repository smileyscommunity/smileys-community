// The host-side no-show guide, as a permanent page.
//
// Why this exists: the host briefing sent on 3 Sep carried host-specific copy
// ("you are the only person who can clear a card") and then linked to the
// MEMBER article, which explains none of that. The email carried the full
// briefing, but the notification promised an explanation and delivered the
// wrong one. This is that explanation, and the 67 delivered notifications are
// repointed at it by repoint-host-no-show-notifications.ts.
//
// Content: the briefing from scripts/notify-hosts-no-show.ts, verbatim in
// substance, with every number interpolated from lib/noShowPolicy so the page
// cannot drift from the code that enforces it.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/publish-no-show-host-guide.ts
//
// Idempotent (skips if the slug exists). notifiedAt is set AT INSERT so no
// broadcast ever fires: the audience already got this as an email, and the
// membership does not need a second bell about a host procedure.
import { prisma } from '@/lib/prisma'
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
export const HOST_GUIDE_SLUG = 'how-no-show-cards-work-for-hosts'
const SHARE = `${Math.round(RATIO * 100)}%`

const TITLE = 'How no-show cards work on your events — a guide for hosts'

const EXCERPT = `Free events settle no-shows automatically about ${DELAY} hours after they end. You are the only person who can clear a card, so here is the whole system from the host's side: when cards are issued, why scanning everyone matters, and what you control.`

const BODY = `<p>Free events settle no-shows automatically. Here is the whole system from your side, because <strong>you are the only person who can clear a card</strong>.</p>

<h2>When cards are issued</h2>
<p>About <strong>${DELAY} hours after your event ends</strong>, if you ran check-in for at least <strong>${SHARE} of the room</strong>, every confirmed attendee who neither checked in nor cancelled ${CUTOFF} hours before the start gets a card. The first one in ${WINDOW} days is yellow — a warning. The second is red: RSVPs pause for ${BLOCK} days, after a ${APPEAL}-hour window to appeal. Paid events are never processed.</p>

<h2>Why the ${SHARE} rule matters</h2>
<p>If you only scanned a few people, the system assumes the door stopped scanning — not that everyone else stayed home — and issues nothing at all. So <strong>scan everyone who walks in</strong>. Missed scans are the main way a good member ends up with a card they did not earn.</p>

<h2>What you see</h2>
<p>A notification and an email when cards are issued for your event, with the count. A <strong>No-shows tab</strong> on your event's participants page listing every card from that event. And on the approval queue, a small 🟨 next to anyone holding an active card — a count, not a history, and only while a card is active. Approved lists and waitlists show nothing.</p>

<h2>What you control</h2>
<p>You can <strong>clear a card</strong> from the No-shows tab. Use it whenever someone was actually there: arrived late, scan missed, you know they came. Say why — it goes in the audit log — and the member is told the card no longer counts. A card you clear never counts toward a red one.</p>
<p>Nothing else. Cards are issued by the system and appeals go to admins. <strong>You never have to be the person who penalises anyone.</strong></p>

<h2>The day-before reconfirmation</h2>
<p>Free events with limited spots ask attendees "still coming?" about ${ASK} hours ahead. Anyone who does not answer loses the seat to the waitlist ${CUTOFF} hours before the start — but only if somebody is actually waiting. Expect a few seats to move overnight; that is the system working.</p>

<h2>What it asks of you</h2>
<p><strong>1.</strong> Run check-in properly, every time, for everyone who arrives.<br>
<strong>2.</strong> If you finish scanning the morning after, that is fine — the sweep waits for you.<br>
<strong>3.</strong> Clear cards for late arrivals and missed scans as soon as you notice.</p>

<h2>What members were told</h2>
<p>Members have their own explanation of the same system: <a href="${NO_SHOW_POLICY_PATH}">How free-event spots work</a>. If someone asks you about a card, that is the page to send them to.</p>

<p>Questions, or a card you think is wrong: message Nate.</p>`

async function main() {
  const existing = await prisma.post.findUnique({ where: { slug: HOST_GUIDE_SLUG }, select: { id: true, status: true } })
  if (existing) { console.log(`✓ already exists (${existing.status}) — nothing to do`); return }

  // Display names are member-editable; the role constraint stops byline spoofing.
  const author = await prisma.user.findFirst({
    where:  { name: 'Nate G.', role: { in: ['admin', 'moderator'] } },
    select: { id: true, name: true },
  })
  if (!author) throw new Error('Author "Nate G." not found')

  console.log(`→ publish "${TITLE}"`)
  console.log(`  slug     /posts/${HOST_GUIDE_SLUG}`)
  console.log(`  author   ${author.name}`)
  console.log(`  bells    none, ever (notifiedAt set at insert)`)
  if (DRY_RUN) {
    console.log('\n  DRY RUN — nothing written')
    console.log(`\n${BODY.replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n')}`)
    return
  }

  const now  = new Date()
  const post = await prisma.post.create({
    data: {
      title:       TITLE,
      slug:        HOST_GUIDE_SLUG,
      excerpt:     EXCERPT,
      body:        BODY,
      status:      'published',
      category:    'Community',
      kind:        'community',
      authorId:    author.id,
      cityId:      null,
      publishedAt: now,
      notifiedAt:  now,   // never broadcast: hosts already got this as an email
    },
    select: { id: true },
  })
  console.log(`✓ published ${post.id}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
