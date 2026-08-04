// Experience pages (§9 of the Guide plan) — designed around DOING, not
// reading: why / The Smileys Take / structured how-to sections / nearby
// neighborhoods / do-it-with-people. Public growth surface like the rest
// of /guide; all content is editorial JSON, no member data.
export const revalidate = 300

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GUIDE_COLLECTIONS } from '@/lib/guide'
import { loadExperiences, getExperience } from '@/lib/guideContent'
import { NEIGHBORHOOD_META, neighborhoodToSlug } from '@/lib/neighborhoods'
import { APP_URL } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import ExperienceActions from './ExperienceActions'
import LiveHangouts from './LiveHangouts'
import EventMatches from './EventMatches'

export function generateStaticParams() {
  return loadExperiences().map(e => ({ slug: e.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const exp = getExperience(slug)
  if (!exp) return {}
  const og = `${APP_URL}/api/og?${new URLSearchParams({ title: exp.title, eyebrow: 'Istanbul Guide' })}`
  return {
    title: `${exp.title} — Istanbul Guide | Smileys Community`,
    description: exp.tagline,
    alternates: { canonical: `${APP_URL}/guide/${exp.slug}` },
    openGraph: {
      title: exp.title,
      description: exp.tagline,
      url: `${APP_URL}/guide/${exp.slug}`,
      images: [{ url: og, width: 1200, height: 630, alt: exp.title }],
    },
    twitter: { card: 'summary_large_image', title: exp.title, description: exp.tagline, images: [og] },
  }
}

export default async function ExperiencePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const exp = getExperience(slug)
  if (!exp) notFound()

  const collection = GUIDE_COLLECTIONS.find(c => c.value === exp.collection)
  const nearby = exp.neighborhoods.filter(n => NEIGHBORHOOD_META[n])

  // §15 — upcoming events in this experience's neighborhoods. Public
  // data, refreshed with the page's ISR window; empty renders nothing.
  const today = new Date().toISOString().split('T')[0]
  const matchedEvents = nearby.length > 0 ? await prisma.event.findMany({
    where:   { status: 'published', date: { gte: today }, neighborhood: { in: nearby } },
    select:  { id: true, title: true, emoji: true, date: true, neighborhood: true },
    orderBy: { date: 'asc' },
    take:    3,
  }) : []
  const related = loadExperiences()
    .filter(e => e.slug !== exp.slug && (e.collection === exp.collection || e.moods.some(m => exp.moods.includes(m))))
    .slice(0, 3)

  return (
    <div className="min-h-screen bg-white">
      {/* Hero — gradient + emoji until experience photography lands. */}
      <div className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-amber-900 overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_75%_30%,#f59e0b_0%,transparent_55%)]" />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-12 sm:pt-14 sm:pb-16">
          <Link href="/guide" className="inline-block text-xs font-bold text-amber-300 hover:text-amber-200 mb-5">
            ← Istanbul Guide
          </Link>
          <div className="flex items-start gap-4">
            <span aria-hidden="true" className="text-5xl sm:text-6xl">{exp.emoji}</span>
            <div>
              {collection && (
                <p className="text-xs font-bold text-amber-300 uppercase tracking-widest mb-1.5">
                  <span aria-hidden="true">{collection.emoji}</span> {collection.label}
                </p>
              )}
              <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
                {exp.title}
              </h1>
            </div>
          </div>
          <p className="text-base sm:text-lg text-gray-300 mt-4 max-w-2xl">{exp.tagline}</p>
          <div className="flex flex-wrap gap-2 mt-5">
            {[exp.cost, exp.time, exp.when].map(chip => (
              <span key={chip} className="text-xs font-semibold text-white bg-white/10 border border-white/10 rounded-full px-3 py-1 backdrop-blur-sm">
                {chip}
              </span>
            ))}
          </div>
          <div className="mt-6">
            <ExperienceActions slug={exp.slug} />
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
        {/* Why do it */}
        <section>
          <h2 className="text-xl font-extrabold tracking-tight text-gray-900 mb-2">Why do it?</h2>
          <p className="text-gray-700 leading-relaxed">{exp.why}</p>
        </section>

        {/* §10 — The Smileys Take. The voice of the whole Guide. */}
        <section className="bg-amber-50 border border-amber-100 rounded-3xl p-6 sm:p-7">
          <h2 className="text-sm font-extrabold tracking-widest uppercase text-amber-700 mb-2.5">
            <span aria-hidden="true">💛</span> The Smileys Take
          </h2>
          <p className="text-gray-800 leading-relaxed font-medium">{exp.take}</p>
        </section>

        {/* Structured sections — routes, rituals, good-to-knows. */}
        {exp.sections.map(sec => (
          <section key={sec.title}>
            <h2 className="text-xl font-extrabold tracking-tight text-gray-900 mb-3">{sec.title}</h2>
            <ul className="space-y-2.5">
              {sec.items.map(item => (
                <li key={item} className="flex items-start gap-2.5 text-gray-700 leading-relaxed">
                  <span aria-hidden="true" className="text-amber-500 font-bold shrink-0 mt-0.5">·</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/* §13 — nearby neighborhoods, linking out instead of duplicating. */}
        {nearby.length > 0 && (
          <section>
            <h2 className="text-xl font-extrabold tracking-tight text-gray-900 mb-3">Explore nearby</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {nearby.map(n => (
                <Link key={n} href={`/neighborhoods/${neighborhoodToSlug(n)}`}
                  className="bg-white border border-gray-100 rounded-2xl p-4 text-center shadow-sm hover:border-amber-300 hover:-translate-y-0.5 transition-all group">
                  <span aria-hidden="true" className="block text-2xl mb-1.5">{NEIGHBORHOOD_META[n].emoji}</span>
                  <span className="block text-sm font-bold text-gray-900 group-hover:text-amber-700 transition-colors">{n}</span>
                  <span className="block text-[11px] text-gray-400 mt-0.5">{NEIGHBORHOOD_META[n].vibe}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* §15/16 — do it with people. Static links in phase 1; live event
            and hangout matches arrive with the social phase. */}
        <section className="bg-gray-900 rounded-3xl p-6 sm:p-8 relative overflow-hidden">
          <div aria-hidden="true" className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_80%_20%,#f59e0b_0%,transparent_60%)]" />
          <h2 className="relative text-xl font-extrabold text-white mb-2">Do it with people</h2>
          <p className="relative text-sm text-gray-300 mb-5">
            The Smileys community does things like this every week — organized events, spontaneous hangouts, and visitors looking for company.
          </p>
          <EventMatches events={matchedEvents} />
          <LiveHangouts neighborhoods={nearby} />
          <div className="relative flex flex-wrap gap-3 mt-5">
            <Link href="/events" className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
              Browse events
            </Link>
            <Link href="/hangouts" className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white text-sm font-bold rounded-xl transition-colors">
              See hangouts
            </Link>
          </div>
        </section>

        {/* Related experiences */}
        {related.length > 0 && (
          <section>
            <h2 className="text-xl font-extrabold tracking-tight text-gray-900 mb-3">More like this</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {related.map(e => (
                <Link key={e.slug} href={`/guide/${e.slug}`}
                  className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-amber-200 hover:shadow-md transition-all group">
                  <span aria-hidden="true" className="block text-2xl mb-2">{e.emoji}</span>
                  <p className="text-sm font-bold text-gray-900 leading-snug group-hover:text-amber-700 transition-colors">{e.title}</p>
                  <span className="inline-block text-xs font-bold text-amber-600 mt-2">Explore →</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="text-center text-sm font-bold text-gray-400 pt-2">There&apos;s always more Istanbul.</p>
      </div>
    </div>
  )
}
