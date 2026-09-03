// Do the published no-show articles still tell the truth?
//
// Both articles were published with every number interpolated from
// lib/noShowPolicy, so copy could not drift from the code that enforces it.
// They were then hand-edited in the admin inline editor (2026-09-03 18:16),
// which is the right way to improve the writing — but it turned the numbers
// into plain text. If a constant changes, the articles now stay stale and
// silently misinform members about when they get a card.
//
// This is the safety net: it reads the live bodies and checks them against the
// constants. Two kinds of finding —
//
//   MISSING      a value the article ought to state is nowhere in it
//   CONTRADICTS  the article states a number the policy does not use
//                (e.g. "60 days" after the window moved to 90)
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/check-policy-copy-drift.ts
//
// Exits 1 on drift so a cron entry can mail the failure; read-only otherwise.
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

const MEMBER_SLUG = NO_SHOW_POLICY_PATH.replace('/posts/', '')
const HOST_SLUG   = 'how-no-show-cards-work-for-hosts'
const SHARE_PCT   = Math.round(RATIO * 100)

/** Values the policy actually uses, by unit. Anything else is a contradiction. */
const VALID_HOURS = new Set([CUTOFF, APPEAL, ASK, DELAY])
const VALID_DAYS  = new Set([WINDOW, BLOCK])

interface Check { label: string; required: number[]; unit: 'hours' | 'days' }

// Only what each audience is actually told. The member article never mentions
// the 2-hour settlement delay or the check-in share; the host guide does.
const CHECKS: Record<string, Check[]> = {
  [MEMBER_SLUG]: [
    { label: 'cancellation cutoff', required: [CUTOFF], unit: 'hours' },
    { label: 'appeal window',       required: [APPEAL], unit: 'hours' },
    { label: 'reconfirm ask',       required: [ASK],    unit: 'hours' },
    { label: 'rolling window',      required: [WINDOW], unit: 'days'  },
    { label: 'red card block',      required: [BLOCK],  unit: 'days'  },
  ],
  [HOST_SLUG]: [
    { label: 'cancellation cutoff', required: [CUTOFF], unit: 'hours' },
    { label: 'appeal window',       required: [APPEAL], unit: 'hours' },
    { label: 'reconfirm ask',       required: [ASK],    unit: 'hours' },
    { label: 'settlement delay',    required: [DELAY],  unit: 'hours' },
    { label: 'rolling window',      required: [WINDOW], unit: 'days'  },
    { label: 'red card block',      required: [BLOCK],  unit: 'days'  },
  ],
}

const strip = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')

/** "12 hours", "12-hour", "12 hour" — however an editor chose to write it. */
const states = (text: string, n: number, unit: 'hours' | 'days') =>
  new RegExp(`\\b${n}[\\s\\u00A0-]?(?:${unit}|${unit.slice(0, -1)})\\b`, 'i').test(text)

async function main() {
  let problems = 0

  for (const [slug, checks] of Object.entries(CHECKS)) {
    const post = await prisma.post.findUnique({ where: { slug }, select: { title: true, body: true, updatedAt: true } })
    if (!post) { console.log(`✗ ${slug} — not published`); problems++; continue }

    const text  = strip(post.body)
    const found: string[] = []

    for (const c of checks) {
      const missing = c.required.filter(n => !states(text, n, c.unit))
      if (missing.length) found.push(`MISSING     ${c.label}: expected ${missing.map(n => `${n} ${c.unit}`).join(', ')}`)
    }

    // Any number-with-unit the policy does not use at all.
    for (const m of text.matchAll(/\b(\d{1,3})[\s -]?(hours?|days?)\b/gi)) {
      const n    = Number(m[1])
      const unit = m[2].toLowerCase().startsWith('h') ? 'hours' : 'days'
      const ok   = unit === 'hours' ? VALID_HOURS.has(n) : VALID_DAYS.has(n)
      if (!ok) found.push(`CONTRADICTS "${m[0]}" — the policy uses no such ${unit} value`)
    }

    // The host guide's check-in share is a percentage, not a duration.
    if (slug === HOST_SLUG && !new RegExp(`\\b${SHARE_PCT}\\s?%`).test(text)) {
      found.push(`MISSING     check-in share: expected ${SHARE_PCT}%`)
    }

    const unique = [...new Set(found)]
    if (unique.length === 0) {
      console.log(`✓ ${slug} — agrees with lib/noShowPolicy (edited ${post.updatedAt.toISOString().slice(0, 10)})`)
    } else {
      console.log(`✗ ${slug} — ${unique.length} problem${unique.length === 1 ? '' : 's'}`)
      for (const f of unique) console.log(`    ${f}`)
      problems += unique.length
    }
  }

  if (problems) {
    console.log(`\n${problems} problem(s). The constants moved and the articles did not — edit them at /admin/posts.`)
    process.exitCode = 1
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
