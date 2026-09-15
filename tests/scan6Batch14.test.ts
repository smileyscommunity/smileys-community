import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Sixth scan, batch 14.
//   15. the host participants page read a 403/429/500 roster as an empty
//       one — a host at the door saw "no attendees". Strict load + Retry.
//   16. CSV formula injection: the host attendee export, the NPS export
//       (member `comment`) and the surveys export (`decline_reason`,
//       `anomaly_note`) only quoted cells. All three now go through toCsv.

const read = (p: string) => readFileSync(p, 'utf8')

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  prisma: {
    memberNPS:    { findMany: vi.fn(), count: vi.fn() },
    eventSurvey:  { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    user:         { findMany: vi.fn(), count: vi.fn() },
  },
}))
vi.mock('@/lib/session', () => ({ getSession: h.getSession }))
vi.mock('@/lib/prisma',  () => ({ prisma: h.prisma }))
vi.mock('@/lib/city',    () => ({ resolveCityId: vi.fn(async () => null), getCityTz: vi.fn(async () => 'Europe/Istanbul') }))

import { GET as npsGET }     from '@/app/api/admin/nps/route'
import { GET as surveysGET } from '@/app/api/admin/surveys/route'

const req = (url: string) => new Request(url) as any
const INJECT = '=HYPERLINK("http://evil.example","click")'
// csvCell: a leading quote neutralises the formula, embedded quotes double.
const NEUTRALISED = `"'=HYPERLINK(""http://evil.example"",""click"")"`

beforeEach(() => {
  vi.clearAllMocks()
  h.getSession.mockResolvedValue({ id: 'a1', name: 'Admin', role: 'admin' })
  h.prisma.eventSurvey.count.mockResolvedValue(0)
  h.prisma.eventSurvey.findMany.mockResolvedValue([])
  h.prisma.user.findMany.mockResolvedValue([])
})

describe('16. NPS CSV export', () => {
  it('a comment starting "=HYPERLINK(" comes out prefixed and quoted; header and response headers unchanged', async () => {
    h.prisma.memberNPS.findMany.mockResolvedValue([
      { score: 3,  comment: INJECT, period: '2026-Q3', createdAt: new Date('2026-09-01T10:00:00Z') },
      { score: 10, comment: null,   period: '2026-Q3', createdAt: new Date('2026-09-02T10:00:00Z') },
    ])
    const res = await npsGET(req('http://x/app/api/admin/nps?format=csv'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="smileys-nps-\d{4}-\d{2}-\d{2}\.csv"$/)
    const lines = (await res.text()).split('\n')
    expect(lines[0]).toBe('"period","score","band","created_at","comment"')
    expect(lines[1]).toBe(`"2026-Q3","3","detractor","2026-09-01T10:00:00.000Z",${NEUTRALISED}`)
    expect(lines[2]).toBe('"2026-Q3","10","promoter","2026-09-02T10:00:00.000Z",""')
  })
})

describe('16. surveys CSV export', () => {
  it('decline_reason and anomaly_note are neutralised; columns and response headers unchanged', async () => {
    h.prisma.eventSurvey.findMany.mockImplementation(async (args: any) => args?.take === 5000 ? [{
      id: 's1', createdAt: new Date('2026-09-03T08:00:00Z'), anomaly: true, anomalyNote: INJECT,
      wouldReturn: false, returnDeclineReason: '+cmd|/c calc',
      event: { id: 'e1', title: 'Picnic', date: '2026-09-02', hostId: null },
    }] : [])
    const res = await surveysGET(req('http://x/app/api/admin/surveys?format=csv'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="smileys-feedback-\d{4}-\d{2}-\d{2}\.csv"$/)
    const lines = (await res.text()).split('\n')
    expect(lines[0]).toBe('"response_id","created_at","event_id","event_title","event_date","event_host_id","would_return","decline_reason","anomaly","anomaly_note"')
    expect(lines[1]).toBe(`"s1","2026-09-03T08:00:00.000Z","e1","Picnic","2026-09-02","","no","'+cmd|/c calc","yes",${NEUTRALISED}`)
    expect(lines).toHaveLength(2)
  })
})

describe('16. no hand-rolled CSV quoting left in the three exports', () => {
  it.each([
    'app/host/events/[id]/participants/page.tsx',
    'app/api/admin/nps/route.ts',
    'app/api/admin/surveys/route.ts',
  ])('%s builds its CSV through toCsv', (file) => {
    const src = read(file)
    expect(src).toContain("import { toCsv } from '@/lib/admin/participantsView'")
    expect(src).toMatch(/toCsv\(/)
    expect(src).not.toContain(`replace(/"/g, '""')`)
    expect(src).not.toMatch(/const esc = /)
  })
  it('the host attendee export passes its header row and rows to toCsv', () => {
    expect(read('app/host/events/[id]/participants/page.tsx')).toContain('const csv  = toCsv(rows)')
  })
})

describe('15. host participants page loads strictly', () => {
  const src = read('app/host/events/[id]/participants/page.tsx')
  const load = src.slice(src.indexOf('useEffect(() => {'), src.indexOf('const retryLoad'))

  it('a non-OK response throws instead of parsing as an empty roster', () => {
    expect(load).toContain('const strict = async (r: Response) => { if (!r.ok) throw await loadFailure(r); return r.json() }')
    expect(load).not.toContain('.then(r => r.json())')
    expect(load).toContain('const data = await strict(rosterRes)')
    expect(load).toContain(".catch((e: Error) => setLoadError(e?.message ?? 'Failed to load'))")
  })
  it('a 404 event decides first and still says not found', () => {
    expect(load).toContain('.then(r => r.status === 404 ? null : strict(r))')
    expect(load.indexOf('if (!ev) { setNotFound(true); return }')).toBeLessThan(load.indexOf('await strict(rosterRes)'))
    expect(src).toContain('if (notFound)  return <div className="p-8 text-center text-zinc-500 text-sm">Event not found</div>')
  })
  it('a failed load renders the error banner with Retry, before any roster UI', () => {
    expect(src).toContain("import LoadErrorBanner from '@/components/admin/LoadErrorBanner'")
    const banner = src.indexOf('if (loadError) return <div className="p-4 sm:p-8"><LoadErrorBanner message={loadError} onRetry={retryLoad}')
    expect(banner).toBeGreaterThan(-1)
    expect(banner).toBeLessThan(src.indexOf('No approved attendees yet.'))
    expect(src).toContain('const retryLoad = () => { setLoading(true); setReloadTick(t => t + 1) }')
    expect(src).toContain('}, [id, reloadTick])')
  })
})
