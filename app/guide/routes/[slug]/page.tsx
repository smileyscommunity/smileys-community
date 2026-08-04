// Route pages (§29) — ordered stops referencing canonical experiences.
// Each stop links to its experience page for the full how-to; routes
// never duplicate that content, they sequence it.
export const revalidate = 300

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadRoutes, getRoute, getExperience } from '@/lib/guideContent'
import { NEIGHBORHOOD_META, neighborhoodToSlug } from '@/lib/neighborhoods'
import { APP_URL } from '@/lib/env'
import TrackedLink from '@/components/TrackedLink'

export function generateStaticParams() {
  return loadRoutes().map(r => ({ slug: r.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const route = getRoute(slug)
  if (!route) return {}
  const og = `${APP_URL}/api/og?${new URLSearchParams({ title: route.title, eyebrow: 'Istanbul Guide · Route' })}`
  return {
    title: `${route.title} — Istanbul Guide | Smileys Community`,
    description: route.tagline,
    alternates: { canonical: `${APP_URL}/guide/routes/${route.slug}` },
    openGraph: {
      title: route.title, description: route.tagline,
      url: `${APP_URL}/guide/routes/${route.slug}`,
      images: [{ url: og, width: 1200, height: 630, alt: route.title }],
    },
    twitter: { card: 'summary_large_image', title: route.title, description: route.tagline, images: [og] },
  }
}

export default async function RoutePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const route = getRoute(slug)
  if (!route) notFound()

  const nearby = route.neighborhoods.filter(n => NEIGHBORHOOD_META[n])

  return (
    <div className="min-h-screen bg-white">
      <div className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-amber-900 overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_75%_30%,#f59e0b_0%,transparent_55%)]" />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-12 sm:pt-14 sm:pb-16">
          <Link href="/guide" className="inline-block text-xs font-bold text-amber-300 hover:text-amber-200 mb-5">
            ← Istanbul Guide
          </Link>
          <p className="text-xs font-bold text-amber-300 uppercase tracking-widest mb-1.5">
            <span aria-hidden="true">{route.emoji}</span> Route · {route.time}
          </p>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">{route.title}</h1>
          <p className="text-base sm:text-lg text-gray-300 mt-4 max-w-2xl">{route.tagline}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
        <p className="text-gray-700 leading-relaxed">{route.intro}</p>

        <section>
          <h2 className="text-xl font-extrabold tracking-tight text-gray-900 mb-4">The route</h2>
          <ol className="space-y-4">
            {route.stops.map((stop, i) => {
              const exp = stop.experience ? getExperience(stop.experience) : undefined
              return (
                <li key={i} className="flex items-start gap-4 bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <span aria-hidden="true" className="shrink-0 w-8 h-8 rounded-full bg-amber-100 text-amber-700 font-extrabold flex items-center justify-center text-sm">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900">{stop.title}</p>
                    <p className="text-sm text-gray-600 mt-1 leading-relaxed">{stop.note}</p>
                    {exp && (
                      <TrackedLink href={`/guide/${exp.slug}`} event="guide_route_to_experience"
                        eventProps={{ route: route.slug, experience: exp.slug }}
                        className="inline-block text-xs font-bold text-amber-600 hover:underline mt-2">
                        <span aria-hidden="true">{exp.emoji}</span> The full guide: {exp.title} →
                      </TrackedLink>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </section>

        {nearby.length > 0 && (
          <section>
            <h2 className="text-xl font-extrabold tracking-tight text-gray-900 mb-3">Along the way</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {nearby.map(n => (
                <TrackedLink key={n} href={`/neighborhoods/${neighborhoodToSlug(n)}`} event="guide_to_neighborhood"
                  eventProps={{ route: route.slug, neighborhood: n }}
                  className="bg-white border border-gray-100 rounded-2xl p-4 text-center shadow-sm hover:border-amber-300 hover:-translate-y-0.5 transition-all group">
                  <span aria-hidden="true" className="block text-2xl mb-1.5">{NEIGHBORHOOD_META[n].emoji}</span>
                  <span className="block text-sm font-bold text-gray-900 group-hover:text-amber-700 transition-colors">{n}</span>
                </TrackedLink>
              ))}
            </div>
          </section>
        )}

        <p className="text-center text-sm font-bold text-gray-400 pt-2">There&apos;s always more Istanbul.</p>
      </div>
    </div>
  )
}
