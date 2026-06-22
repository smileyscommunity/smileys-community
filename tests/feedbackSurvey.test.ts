import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  event:         { findUnique: vi.fn() },
  eventAttendee: { findUnique: vi.fn() },
  eventSurvey:   { upsert: vi.fn() },
  report:        { create: vi.fn() },
  user:          { findMany: vi.fn() },
} }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn() }))

import { POST } from '@/app/api/events/[id]/feedback/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const params = { params: Promise.resolve({ id: 'e1' }) }
const req = (body: any) => ({ json: async () => body }) as any

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'u1', name: 'U' })
})

describe('events/[id]/feedback POST — anomaly note is mandatory', () => {
  it('400 when anomaly / wouldReturn are not booleans', async () => {
    const res = await POST(req({ anomaly: 'yes', wouldReturn: true }), params)
    expect(res.status).toBe(400)
    expect(prisma.event.findUnique).not.toHaveBeenCalled()
  })

  it('400 when an anomaly is flagged with no note', async () => {
    const res = await POST(req({ anomaly: true, wouldReturn: true }), params)
    expect(res.status).toBe(400)
    expect(prisma.event.findUnique).not.toHaveBeenCalled()
  })

  it('400 when the anomaly note is too short (<10 chars)', async () => {
    const res = await POST(req({ anomaly: true, wouldReturn: true, anomalyNote: 'short' }), params)
    expect(res.status).toBe(400)
  })

  it('passes validation with a sufficient note (then 404 on missing event)', async () => {
    ;(prisma.event.findUnique as any).mockResolvedValue(null)
    const res = await POST(req({ anomaly: true, wouldReturn: true, anomalyNote: 'something genuinely felt off here' }), params)
    expect(prisma.event.findUnique).toHaveBeenCalled()
    expect(res.status).toBe(404)
  })

  it('no-anomaly survey skips the note requirement entirely', async () => {
    ;(prisma.event.findUnique as any).mockResolvedValue(null)
    const res = await POST(req({ anomaly: false, wouldReturn: true }), params)
    expect(prisma.event.findUnique).toHaveBeenCalled() // got past validation
    expect(res.status).toBe(404)
  })
})
