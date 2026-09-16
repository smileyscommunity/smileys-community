import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'

// Two small production findings, 2026-09-16:
//  · push subscribe refused a Chrome endpoint on jmt17.google.com, so that
//    member could not turn notifications on (three older subscriptions on the
//    same host already deliver fine). jmtN.google.com is accepted; the rest of
//    google.com still is not.
//  · a rejected application's photo file never finished uploading, and the
//    admin applications page showed a broken-image icon. It now falls back to
//    the same placeholder as "no photo".

const read = (p: string) => readFileSync(p, 'utf-8')

const session = vi.hoisted(() => ({ current: null as null | { id: string } }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    pushSubscription: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})), findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({})) },
  },
}))

import { POST as subscribePOST } from '@/app/api/push/subscribe/route'
import { prisma } from '@/lib/prisma'

const p = prisma as any
const keys = { p256dh: 'p'.repeat(40), auth: 'a'.repeat(22) }
const subscribe = (endpoint: string) => subscribePOST(new Request('https://x/app/api/push/subscribe', {
  method: 'POST', body: JSON.stringify({ endpoint, keys }),
}) as never)

beforeEach(() => {
  vi.clearAllMocks()
  session.current = { id: 'u1' }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('push subscribe accepts Google\'s jmtN push hosts', () => {
  it.each(['https://jmt17.google.com/fcm/send/abc-123', 'https://jmt0.google.com/fcm/send/xyz'])('%s is stored', async (endpoint) => {
    const res = await subscribe(endpoint)
    expect(res.status).toBe(200)
    expect(p.pushSubscription.upsert).toHaveBeenCalledTimes(1)
  })

  it.each([
    'https://evil.google.com/fcm/send/x',
    'https://jmt17.google.com.evil.example/fcm/send/x',
    'https://xjmt17.google.com/fcm/send/x',
    'https://jmt1234.google.com/fcm/send/x',
    'http://jmt17.google.com/fcm/send/x',
  ])('%s is still refused', async (endpoint) => {
    const res = await subscribe(endpoint)
    expect(res.status).toBe(400)
    expect(p.pushSubscription.upsert).not.toHaveBeenCalled()
  })

  it('the existing hosts still work', async () => {
    expect((await subscribe('https://fcm.googleapis.com/fcm/send/d1')).status).toBe(200)
    expect((await subscribe('https://wns2-par02p.notify.windows.com/w/?token=t')).status).toBe(200)
  })
})

describe('admin applications page survives a missing photo file', () => {
  const src = read('app/admin/applications/page.tsx')

  it('renders applicant photos through a component that falls back on load error', () => {
    expect(src).toMatch(/function ApplicantPhoto\(/)
    expect(src).toMatch(/onError=\{\(\) => setFailed\(true\)\}/)
    expect(src).toMatch(/if \(!src \|\| failed\)/)
  })

  it('both the list avatar and the detail photo use it; no bare photo img is left', () => {
    expect(src.match(/<ApplicantPhoto key=\{[a-z]+\.profilePhoto \?\? 'none'\}/g) ?? []).toHaveLength(2)
    expect(src).not.toMatch(/<img src=\{resolveImageUrl\((app|selected)\.profilePhoto\)\}/)
  })
})
