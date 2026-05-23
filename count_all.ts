import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.log('DATABASE_URL not set')
    return
  }
  
  const pool = new pg.Pool({ connectionString })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  try {
    const counts = {
      users: await prisma.user.count(),
      events: await prisma.event.count(),
      clubs: await prisma.club.count(),
      applications: await prisma.memberApplication.count(),
      rsvps: await prisma.eventAttendee.count(),
      payments: await prisma.payment.count(),
      audit: await prisma.auditLog.count(),
    }
    console.log('Counts:', counts)
  } catch (e) {
    console.error('Error:', e)
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main()
