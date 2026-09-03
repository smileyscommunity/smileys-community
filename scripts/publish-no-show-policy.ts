// Publish the member-facing no-show policy article — the permanent, linkable
// statement of the rules. Until now the only complete statement lived in
// docs/no-show-announcement.draft.md; /no-show shows a member their OWN
// standing, not the policy, so the 13 people who got a card on 2 Sep had
// nowhere to read the whole thing.
//
// Global on purpose (cityId null): the policy applies in every city.
// Content: docs/no-show-announcement.draft.md, §1, rewritten as a standing
// page rather than a dated letter. Every number is interpolated from
// lib/noShowPolicy so the article cannot drift from the code that enforces it.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/publish-no-show-policy.ts
//
// Two-phase on purpose, because the host briefing links to this article and so
// must be sent after it exists but before members are belled:
//
//   1. SKIP_BROADCAST=1 …  publishes the article, notifies nobody.
//   2. (brief the hosts)
//   3. (no flag) …         finds the published-but-unannounced article and
//                          fires the membership broadcast.
//
// Idempotent throughout: notifyNewArticle claims notifiedAt atomically, so a
// third run is a no-op. Run without the flag from cold and it does both at once.
import { prisma } from '@/lib/prisma'
import { notifyNewArticle } from '@/lib/notify'
import {
  NO_SHOW_CANCELLATION_CUTOFF_HOURS as CUTOFF,
  NO_SHOW_ROLLING_WINDOW_DAYS as WINDOW,
  RED_CARD_BLOCK_DAYS as BLOCK,
  RED_CARD_APPEAL_WINDOW_HOURS as APPEAL,
  RECONFIRM_ASK_HOURS_BEFORE as ASK,
} from '@/lib/noShowPolicy'

const DRY_RUN        = process.env.DRY_RUN === '1'
const SKIP_BROADCAST = process.env.SKIP_BROADCAST === '1'
const SLUG = 'how-free-event-spots-work'

const TITLE = 'How free-event spots work — and what counts as a no-show'

const EXCERPT = `Most of our events are free, and most of them fill up. When someone books a seat and doesn't come, that seat was somebody else's night out. Here is the whole system, in full, so nothing surprises you.`

const BODY = `<p>Most of our events are free, and most of them fill up. When someone books a seat and doesn't come, that seat was somebody else's night out — usually somebody who was sitting on the waitlist all week. So free events now keep a simple record of who showed up.</p>
<p>This started on <strong>2 September 2026</strong>, and the first cards have already gone out. If you got one, this page is the rest of the explanation. If you didn't, this is everything you'd want to know before you next book a spot.</p>

<h2>What counts as a no-show</h2>
<p>All three of these have to be true: you were confirmed for a <strong>free</strong> event, the host ran check-in at the door, and you neither checked in nor cancelled at least <strong>${CUTOFF} hours</strong> before the start. That's it. Paid events are never part of this.</p>

<h2>What happens</h2>
<p><strong>First time in ${WINDOW} days — a yellow card.</strong> It's a heads-up, nothing more. You'll get an email and a notification, and the next time you RSVP we'll ask you to confirm you're really coming. It expires on its own.</p>
<p><strong>Second time in ${WINDOW} days — a red card.</strong> RSVPs and waitlists pause for <strong>${BLOCK} days</strong>. You have <strong>${APPEAL} hours</strong> to appeal before the pause starts, and an admin reads every appeal. Everything else on Smileys stays open, and any RSVP you already hold still stands.</p>

<h2>The fair-play rules built in</h2>
<p><strong>Cancel in time and nothing happens.</strong> Up to ${CUTOFF} hours before the start, cancelling is exactly what we want you to do — it hands the seat to the waitlist. No card, no record, no hard feelings.</p>
<p><strong>If you were there but the scan was missed, tell the host.</strong> They can clear it in one click and it never counts toward anything.</p>
<p><strong>We only count events where check-in really ran.</strong> If the host scanned a couple of people and then got busy, that's not evidence the rest of the room stayed home — so nobody gets a card.</p>
<p><strong>If a host or admin removes you from an event, that is never held against you.</strong> Only your own late cancellation counts.</p>
<p><strong>Nothing is public.</strong> Cards are between you, the host of that event, and the admins. Other members never see them, and they appear nowhere on your profile.</p>

<h2>"Still coming?"</h2>
<p>For free events with limited spots, you'll get a message about ${ASK} hours before asking if you're still coming. Tap yes and you're set.</p>
<p>If you don't answer <em>and</em> somebody is actually waiting for your seat, it's released ${CUTOFF} hours before the start — before it could ever count as a no-show. So silence costs you the seat, never a card, and never when the waitlist is empty. You're told when it happens and you can rejoin.</p>

<h2>Where to check</h2>
<p>Your own standing is always at <a href="/no-show">Your RSVP standing</a>. If you have nothing on record, that's exactly what it will say.</p>

<p>Cancel when plans change, check in when you arrive, and none of this will ever touch you. Thanks for keeping our events full of people who actually turn up.</p>`

async function main() {
  const existing = await prisma.post.findUnique({
    where:  { slug: SLUG },
    select: { id: true, status: true, title: true, slug: true, kind: true, authorId: true, cityId: true, notifiedAt: true },
  })
  if (existing) {
    if (existing.notifiedAt) { console.log(`✓ published and announced ${existing.notifiedAt.toISOString()} — nothing to do`); return }
    if (SKIP_BROADCAST)      { console.log(`✓ already published (${existing.status}), broadcast still pending — nothing to do`); return }
    const pending = await prisma.user.count({ where: { status: 'approved', id: { not: existing.authorId } } })
    console.log(`→ article exists (${existing.status}) and has never been announced`)
    console.log(`  bells    ${pending} approved members`)
    if (DRY_RUN) { console.log('\n  DRY RUN — nobody notified'); return }
    await notifyNewArticle(existing)
    console.log('✓ broadcast claimed and fanned out')
    return
  }

  // Display names are member-editable; the role constraint stops byline spoofing.
  const author = await prisma.user.findFirst({
    where:  { name: 'Nate G.', role: { in: ['admin', 'moderator'] } },
    select: { id: true, name: true },
  })
  if (!author) throw new Error('Author "Nate G." not found')

  const recipients = await prisma.user.count({
    where: { status: 'approved', id: { not: author.id } },
  })

  console.log(`→ publish "${TITLE}"`)
  console.log(`  slug     /posts/${SLUG}`)
  console.log(`  author   ${author.name}`)
  console.log(`  city     (global — every city)`)
  console.log(SKIP_BROADCAST
    ? `  bells    none this run (SKIP_BROADCAST=1) — ${recipients} pending for the follow-up run`
    : `  bells    ${recipients} approved members (minus anyone who muted new_article / is in quiet hours)`)
  if (DRY_RUN) {
    console.log('\n  DRY RUN — nothing written, nobody notified')
    console.log(`\n${BODY.replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n')}`)
    return
  }

  const now  = new Date()
  const post = await prisma.post.create({
    data: {
      title:       TITLE,
      slug:        SLUG,
      excerpt:     EXCERPT,
      body:        BODY,
      status:      'published',
      category:    'Community',
      kind:        'community',
      authorId:    author.id,
      cityId:      null,
      publishedAt: now,
      // notifiedAt deliberately left null — notifyNewArticle claims it below.
    },
    select: { id: true, title: true, slug: true, kind: true, authorId: true, cityId: true },
  })
  console.log(`✓ published ${post.id}`)

  if (SKIP_BROADCAST) {
    console.log('  broadcast skipped — re-run without SKIP_BROADCAST to announce it')
    return
  }
  await notifyNewArticle(post)
  console.log(`✓ broadcast claimed and fanned out`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
