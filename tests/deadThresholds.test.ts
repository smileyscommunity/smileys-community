import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { YELLOW_AFTER_OFFENCES } from '@/lib/standingPolicy'
import { THRESHOLDS } from '@/lib/connectionAbuse'

const read = (p: string) => readFileSync(p, 'utf8')
const scan = read('scripts/scan-dead-thresholds.ts')

// On 2026-09-20 three separate surfaces were found showing nothing and
// reading as all-clear, each because its threshold sat above anything in the
// data: the No-shows tab needed 3 settled no-shows when the most anyone had
// was 2; the connection-abuse panel needed 20 requests when nobody had sent
// 20; and the review gate ANDed against a stamp standing never writes.
//
// None of that is catchable from source alone — reachability is a fact about
// production data — so the guard is a scan that measures it (run weekly,
// mails only on a failure). These tests hold the two things about that scan
// which ARE checkable here: that it stays wired to the real constants, and
// that it actually runs on the server.

describe('the threshold-reachability scan', () => {
  it('reads the live constants, so moving a bar moves the check with it', () => {
    expect(scan).toMatch(/from '@\/lib\/standingPolicy'/)
    expect(scan).toMatch(/from '@\/lib\/connectionAbuse'/)
    expect(scan).toContain('threshold: YELLOW_AFTER_OFFENCES')
    expect(scan).toContain('threshold: THRESHOLDS.MIN_REQUESTS')
    expect(scan).toContain('threshold: THRESHOLDS.MIN_DM_PARTNERS')
    // A literal here would be the very bug the scan exists to find.
    expect(scan).not.toMatch(/threshold:\s*\d+/)
  })

  it('covers each surface that was found dead, so none silently loses its check', () => {
    for (const surface of ['/admin/users', '/admin/abuse', '/admin/standing']) {
      expect(scan, `no check for ${surface}`).toContain(surface)
    }
  })

  // Its first run called standing's yellow card dead: the bar is 2 offences
  // and nobody had 2 — because offences had only just started accruing, not
  // because the rule was broken. A scan that cries wolf is how the next real
  // finding gets ignored, so the two cases are named apart.
  it('separates a bar nobody CAN reach from one nobody HAS reached yet', () => {
    expect(scan).toContain("kind:      'heuristic'")
    expect(scan).toContain("kind:      'policy'")
    expect(scan).toMatch(/c\.kind === 'heuristic' \? 'DEAD ' : 'ARMED'/)
    // Only a genuinely unreachable bar counts as a failure.
    expect(scan).toMatch(/if \(verdict === 'DEAD '\) dead\+\+/)
  })

  it('stays quiet when everything is reachable', () => {
    // A weekly "all clear" is how a report stops being read.
    expect(scan).toMatch(/if \(dead === 0\) \{ console\.log\('nothing dead — no email sent'\); return \}/)
  })

  it('never writes', () => {
    expect(scan).not.toMatch(/prisma\.\w+\.(update|create|delete|upsert)/)
    expect(scan).not.toMatch(/\$executeRaw/)
  })

  it('agrees with the thresholds it is meant to police', () => {
    // Sanity on the constants themselves: a bar of 0 or 1 makes any surface
    // fire for everyone, which fails just as quietly in the other direction.
    expect(YELLOW_AFTER_OFFENCES).toBeGreaterThan(1)
    expect(THRESHOLDS.MIN_REQUESTS).toBeGreaterThan(1)
    expect(THRESHOLDS.MIN_DM_PARTNERS).toBeGreaterThan(1)
  })
})

// A scan nobody runs is worth nothing, and this repo has been bitten by that
// exact shape before: sweeper scripts deployed at 644 failed silently on every
// tick. deploy.sh is what installs them, so every wrapper must be chmod'd and
// given a crontab line there — including any added later.
describe('every sweeper is actually installed by deploy.sh', () => {
  const deploy   = read('deploy.sh')
  const sweepers = readdirSync('scripts').filter(f => f.startsWith('sweep-') && f.endsWith('.sh'))

  it('found the sweepers', () => {
    expect(sweepers.length).toBeGreaterThan(15)
    expect(sweepers).toContain('sweep-dead-thresholds.sh')
  })

  it.each(sweepers)('%s is chmod +x and given a crontab line', (file) => {
    expect(deploy, `${file}: no chmod +x in deploy.sh`).toContain(`chmod +x $REMOTE/scripts/${file}`)
    // The crontab line and the log path, on one line or several.
    expect(deploy, `${file}: no crontab entry in deploy.sh`)
      .toMatch(new RegExp(`crontab.*${file.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`, 's'))
  })

  it.each(sweepers)('%s is executable in the repo', (file) => {
    // Mode 644 in git is how they died last time.
    expect(statSync(`scripts/${file}`).mode & 0o111, `${file} is not executable`).toBeGreaterThan(0)
  })
})
