import Link from 'next/link'
import { prisma } from '@/lib/prisma'

interface Props {
  name: string
  groupLink?: string
  groupLabel?: string
  userId?: string
  isYourNeighborhood: boolean
}

export default async function HeroStats({ name, groupLink, groupLabel, userId, isYourNeighborhood }: Props) {
  const today = new Date().toISOString().split('T')[0]
  const monthStart = new Date()
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const monthStr = monthStart.toISOString().split('T')[0]

  const [monthlyCount, pastCount, totalLocals, approvedHost] = await Promise.all([
    prisma.event.count({ where: { neighborhood: name, date: { gte: monthStr } } }),
    prisma.event.count({ where: { neighborhood: name, date: { lt: today } } }),
    prisma.user.count({ where: { neighborhood: name, status: 'approved' } }),
    userId
      ? prisma.clubMembership.findFirst({
          where: { userId, role: 'host', status: 'approved' },
          select: { id: true },
        })
      : null,
  ])

  return (
    <>
      <div className="mt-5 flex items-center gap-5 text-sm flex-wrap">
        {monthlyCount > 0 && (
          <span className="text-white/60">
            <strong className="text-white">{monthlyCount}</strong> event{monthlyCount !== 1 ? 's' : ''} this month
          </span>
        )}
        <span className="text-white/60">
          <strong className="text-white">{pastCount}</strong> past event{pastCount !== 1 ? 's' : ''}
        </span>
        {totalLocals > 0 && (
          <span className="text-white/60">
            <strong className="text-white">{totalLocals}</strong> local member{totalLocals !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        {groupLink && (
          <a href={groupLink} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white/15 backdrop-blur-sm border border-white/25 text-white text-xs font-semibold rounded-xl hover:bg-white/25 transition-colors">
            💬 {groupLabel ?? 'Join group'}
          </a>
        )}
        {approvedHost && (
          <Link href={`/host/events/new?neighborhood=${encodeURIComponent(name)}`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-amber-600 text-xs font-bold rounded-xl hover:bg-amber-50 transition-colors shadow-sm">
            + Host an event here
          </Link>
        )}
      </div>

      {isYourNeighborhood && (
        <div className="mt-6 inline-flex items-center gap-2.5 bg-white/15 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 text-sm">
          <span className="text-base">🏡</span>
          <span className="text-white font-medium">
            You're among {totalLocals} local Smileys member{totalLocals !== 1 ? 's' : ''} here
          </span>
        </div>
      )}
    </>
  )
}
