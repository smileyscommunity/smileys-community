// User.referralCount against the source of truth. The 2026-09 production
// audit found it drifted for 20 users: nothing ever incremented it, so it held
// whatever it was seeded or reset to. Every display now computes the count
// from approved applications carrying the member's code (lib/referrals), and
// nothing reads the column — this keeps it consistent until it is dropped.
//
// Computed = MemberApplication rows with referredBy = the user's referralCode
// and status in REFERRAL_COUNTED_STATUSES. A user with no code computes 0.
//
//   (default)  DRY_RUN: list every user whose stored count differs, old → new.
//   APPLY=1    set each one, guarded on the value it was read at
//              (WHERE id = … AND "referralCount" = <old>), so a row that
//              changed since the read is skipped, not overwritten.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/repair-referral-counts.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/repair-referral-counts.ts

import { prisma } from '@/lib/prisma'
import { REFERRAL_COUNTED_STATUSES } from '@/lib/referrals'

const APPLY_MODE = process.env.APPLY === '1'

export interface StoredReferral {
  id:            string
  referralCode:  string | null
  referralCount: number
}

export interface ReferralRepair {
  id:           string
  referralCode: string | null
  old:          number
  new:          number
}

export function planReferralRepairs(users: StoredReferral[], countsByCode: Map<string, number>) {
  const repairs: ReferralRepair[] = []
  for (const u of users) {
    const computed = u.referralCode ? countsByCode.get(u.referralCode) ?? 0 : 0
    if (computed !== u.referralCount) {
      repairs.push({ id: u.id, referralCode: u.referralCode, old: u.referralCount, new: computed })
    }
  }
  repairs.sort((a, b) => Math.abs(b.new - b.old) - Math.abs(a.new - a.old) || a.id.localeCompare(b.id))
  return {
    repairs,
    counts: {
      checked: users.length,
      drifted: repairs.length,
      tooHigh: repairs.filter(r => r.old > r.new).length,
      tooLow:  repairs.filter(r => r.old < r.new).length,
    },
  }
}

export async function applyReferralRepairs(repairs: ReferralRepair[]) {
  let updated = 0, skipped = 0
  for (const r of repairs) {
    const res = await prisma.user.updateMany({
      where: { id: r.id, referralCount: r.old },
      data:  { referralCount: r.new },
    })
    if (res.count === 1) updated++
    else skipped++
  }
  return { updated, skipped }
}

async function load() {
  const [users, groups] = await Promise.all([
    // Anyone who could differ: a code to count against, or a non-zero stored
    // value (a user whose code was cleared must read 0).
    prisma.user.findMany({
      where:  { OR: [{ referralCode: { not: null } }, { referralCount: { not: 0 } }] },
      select: { id: true, referralCode: true, referralCount: true },
    }),
    prisma.memberApplication.groupBy({
      by:     ['referredBy'],
      where:  { referredBy: { not: null }, status: { in: [...REFERRAL_COUNTED_STATUSES] } },
      _count: { _all: true },
    }),
  ])
  const countsByCode = new Map<string, number>()
  for (const g of groups) if (g.referredBy) countsByCode.set(g.referredBy, g._count._all)
  return { users, countsByCode }
}

async function main() {
  console.log(APPLY_MODE ? 'APPLY — updating drifted referralCount values\n' : 'DRY RUN — nothing is written. APPLY=1 updates.\n')
  const { users, countsByCode } = await load()
  const { repairs, counts } = planReferralRepairs(users, countsByCode)

  // Every row, never truncated.
  for (const r of repairs) console.log(`  ${r.id} code=${r.referralCode ?? '-'} referralCount ${r.old} → ${r.new}`)
  console.log(`\nsummary: checked=${counts.checked} drifted=${counts.drifted} (stored too high=${counts.tooHigh}, too low=${counts.tooLow})`)

  if (!APPLY_MODE || repairs.length === 0) return
  const { updated, skipped } = await applyReferralRepairs(repairs)
  console.log(`\napplied: updated=${updated} skipped=${skipped} (value changed since the read)`)
}

// Only run as a CLI — tests import the planning functions.
if (/repair-referral-counts\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
