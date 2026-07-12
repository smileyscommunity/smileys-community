import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canModerateReports } from '@/lib/access'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const REASON_LABELS: Record<string, string> = {
  harassment:    'Harassment or bullying',
  spam:          'Spam or self-promotion',
  inappropriate: 'Inappropriate content',
  fake:          'Fake profile or impersonation',
  offensive:     'Offensive content',
  other:         'Other',
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canModerateReports(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { reportId } = await req.json()
  if (!reportId) return NextResponse.json({ error: 'Missing reportId' }, { status: 400 })

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      reporter: { select: { name: true } },
      reported: {
        select: {
          name: true, status: true, warningCount: true, joinedAt: true,
          _count: { select: { reportsReceived: true } },
        },
      },
    },
  })

  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const prompt = `You are a community moderator for Smileys, a curated social community in Istanbul. Review this user report and recommend an action.

Respond with a JSON object in exactly this format:
{
  "recommendation": "dismiss" | "warn" | "ban",
  "confidence": number (0-100),
  "reasoning": "one or two sentence explanation of your recommendation"
}

Rules:
- "dismiss" = report seems unfounded, minor, or lacks evidence
- "warn" = behavior is problematic but not severe enough for a ban; a warning is proportionate
- "ban" = clear violation, repeated offense, harassment, or safety issue

Report details:
- Reason: ${REASON_LABELS[report.reason] ?? report.reason}
- Details from reporter: ${report.details || '(none provided)'}
- Reporter: ${report.reporter.name}
- Reported user: ${report.reported.name}
- Reported user status: ${report.reported.status}
- Warning count on reported user: ${report.reported.warningCount ?? 0}
- Times this user has been reported before: ${Math.max(0, (report.reported._count.reportsReceived ?? 1) - 1)}
- Member since: ${new Date(report.reported.joinedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    })

    const raw = JSON.parse(completion.choices[0].message.content ?? '{}')
    return NextResponse.json({
      recommendation: raw.recommendation ?? 'dismiss',
      confidence:     raw.confidence     ?? 50,
      reasoning:      raw.reasoning      ?? '',
    })
  } catch (e) {
    console.error('OpenAI triage error', e)
    return NextResponse.json({ error: 'Failed to triage report' }, { status: 500 })
  }
}
