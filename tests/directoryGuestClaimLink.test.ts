import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// A signed-out visitor to an unclaimed listing used to see no footer at all,
// so the owners of a business, the people least likely to be signed in, never
// saw that a claim exists.
const src = readFileSync(join(__dirname, '../app/directory/[id]/DetailClient.tsx'), 'utf8')
const start = src.indexOf('if (!currentUserId) {')
const guestBranch = src.slice(start, src.indexOf('<div className="mt-6">\n      {claimOpen'))

describe('directory listing footer for guests', () => {
  it('offers "Is this your business?" on an unclaimed listing, back to the same listing after sign-in', () => {
    expect(guestBranch).toContain('Is this your business?')
    expect(guestBranch).toContain('/login?return=/directory/${business.id}')
  })
  it('shows nothing once the listing already has an owner, and no report button for guests', () => {
    expect(guestBranch).toMatch(/if \(business\.hasClaimedOwner\) return null/)
    expect(guestBranch).not.toContain('DirectoryReportButton')
  })
})
