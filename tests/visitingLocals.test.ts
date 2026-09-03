import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

// Host mode on /visiting is built on the openTo* flags a member already sets in
// settings ("🏠 Hosting visitors"), not on a new column. Two rules matter and
// neither is visible from the component alone:
//
//   1. Opted-in hosts sort first. The page used to rank locals purely by
//      goodHangouts and present them to visitors, though none of them had been
//      asked whether they welcome strangers.
//   2. Guests never receive the flags. Hiding them in the render is not enough
//      — props reach the browser in the RSC payload, so a guest would be sent
//      preferences that only exist on the members-only directory today.
//
// Asserted against the source because both live in a server component that
// cannot be imported here (it opens a DB connection at module load).

const page = readFileSync('app/visiting/page.tsx', 'utf-8')

describe('/visiting locals', () => {
  it('sorts members who opted into hosting ahead of the rest', () => {
    expect(page).toMatch(/orderBy:\s*\[\{\s*openToHosting:\s*'desc'\s*\}/)
  })

  it('still falls back to goodHangouts, so the strip never empties', () => {
    expect(page).toMatch(/openToHosting:\s*'desc'\s*\},\s*\{\s*goodHangouts:\s*'desc'\s*\}/)
  })

  it('strips the openTo flags for logged-out viewers', () => {
    // The redaction must be keyed on the session and rebuild the object from
    // an explicit field list — a blocklist would leak the next flag added.
    expect(page).toMatch(/const localsForViewer = session/)
    expect(page).toMatch(/featuredLocals\.map\(\(\{ id, name, color, profilePhoto, neighborhood \}\)/)
  })

  it('passes the redacted list to the client, never the raw one', () => {
    expect(page).toContain('featuredLocals={localsForViewer}')
    expect(page).not.toContain('featuredLocals={featuredLocals}')
  })
})

describe('/visiting locals strip', () => {
  const client = readFileSync('app/visiting/VisitingClient.tsx', 'utf-8')

  it('only claims locals welcome visitors when one actually said so', () => {
    expect(client).toContain("'Locals happy to meet visitors' : 'Meet some locals'")
    expect(client).toMatch(/const anyHost = visible\.slice\(0, 4\)\.some\(l => l\.openToHosting\)/)
  })

  it('gates the pills on a signed-in viewer as well', () => {
    expect(client).toMatch(/viewerId && \(l\.openToHosting \|\| l\.openToCoffee \|\| l\.openToLanguage\)/)
  })
})
