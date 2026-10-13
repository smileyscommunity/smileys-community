import Link from 'next/link'
import { APP_URL } from '@/lib/env'
import { previewUrl } from '@/lib/data'
import { COLLAB_TYPES, PARTNER_CONTACT_EMAIL, getAudienceStats, getCaseStudies, getSelectedCoverage } from '@/lib/partners'
import PartnersEnquiryForm from './PartnersEnquiryForm'
import PageViewTracker from '@/components/PageViewTracker'
import PartnerCtaLink from '@/components/PartnerCtaLink'

export const revalidate = 3600

const ogImage = `${APP_URL}/api/og?${new URLSearchParams({
  title: "Bring your event to Istanbul's international community.",
  eyebrow: 'Partner with Smileys',
  cta: 'Discuss a partnership',
}).toString()}`
const DESCRIPTION = 'Connect with expats, international students, digital nomads, and globally minded locals through English-language editorial coverage, community recommendations, and event collaborations.'

export const metadata = {
  title: "Partner with Smileys — Bring your event to Istanbul's international community",
  description: DESCRIPTION,
  alternates: { canonical: `${APP_URL}/partner-with-us` },
  openGraph: {
    title: "Bring your event to Istanbul's international community",
    description: DESCRIPTION,
    url: `${APP_URL}/partner-with-us`,
    images: [{ url: ogImage, width: 1200, height: 630, alt: 'Partner with Smileys Community' }],
  },
  twitter: { card: 'summary_large_image', title: 'Partner with Smileys Community', description: DESCRIPTION, images: [ogImage] },
}

const AUDIENCE = [
  { icon: '🌍', title: 'Expats and international professionals', body: 'People building a life in Istanbul who look for things to do in English and rely on a trusted voice to tell them what is worth their evening.' },
  { icon: '🎓', title: 'International students', body: 'Exchange and degree students who are new to the city, often looking for culture, music and nights out they can join without a language barrier.' },
  { icon: '💻', title: 'Digital nomads and remote workers', body: 'Longer-stay visitors who want to meet people and see the city beyond the tourist trail.' },
  { icon: '🤝', title: 'Globally minded locals', body: 'Local members who enjoy international company and events that work for a mixed-language crowd.' },
]

const WAYS = [
  { icon: '📰', title: 'English-language event coverage and practical guides', body: 'An article that explains your event for newcomers: what it is, where, how to get there, and how to book.' },
  { icon: '🎤', title: 'Artist or organizer interviews', body: 'A conversation with the people behind the event, written for an international audience.' },
  { icon: '🏷️', title: 'Member discounts and group offers', body: 'An offer for Smileys members, shared only through the channels you approve.' },
  { icon: '🎟️', title: 'Approved ticket giveaways', body: 'A giveaway of tickets you provide, run only when you agree to it.' },
  { icon: '👥', title: 'Hosted community attendance', body: 'A Smileys host organizes a group to attend together, so members arrive with people to meet.' },
  { icon: '💼', title: 'Relevant business-event partnerships', body: 'Conferences, networking and professional events that suit an international professional audience.' },
]

const nf = new Intl.NumberFormat('en-US')
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export default async function PartnersPage() {
  const [stats, coverage] = await Promise.all([getAudienceStats(), getSelectedCoverage()])
  const caseStudies = getCaseStudies()

  return (
    <div className="min-h-screen bg-warm">
      <PageViewTracker event="partner_page_view" />

      <section className="bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-14 sm:py-20 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-4">Partner with Smileys</p>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight mb-5">
            Bring your event to Istanbul&apos;s international community.
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed max-w-2xl mx-auto mb-8">{DESCRIPTION}</p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <PartnerCtaLink href="#enquire" cta="hero_discuss" className="px-7 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm text-center transition-colors">
              Discuss a partnership
            </PartnerCtaLink>
            <PartnerCtaLink href={coverage.length ? '#coverage' : '/posts'} cta="hero_coverage" className="px-7 py-3.5 rounded-xl border border-gray-300 text-gray-800 font-semibold text-sm text-center hover:bg-gray-50 transition-colors">
              Explore our coverage
            </PartnerCtaLink>
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
        <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Who our members are</h2>
        <p className="text-gray-600 max-w-2xl mb-8">
          Smileys is a curated community: members apply and are reviewed. They come to meet people in person, and
          events they can enjoy in English or without needing the local language are the ones that reach them most naturally.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {AUDIENCE.map(a => (
            <div key={a.title} className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="text-2xl mb-2" aria-hidden="true">{a.icon}</div>
              <h3 className="font-bold text-gray-900 mb-1">{a.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{a.body}</p>
            </div>
          ))}
        </div>

        {stats && (
          <div className="mt-8 bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
            <h3 className="font-bold text-gray-900">The community in numbers</h3>
            <p className="text-xs text-gray-500 mb-4">
              Measured from our own records on {fmtDay(stats.asOf)}. These are separate groups that overlap — please don&apos;t add them together.
            </p>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {stats.stats.map(s => (
                <div key={s.label} className="rounded-xl bg-amber-50/60 p-4">
                  <dt className="text-xs font-bold uppercase tracking-wide text-amber-700">{s.label}</dt>
                  <dd className="text-3xl font-extrabold text-gray-900 my-1">{nf.format(s.value)}</dd>
                  <dd className="text-xs text-gray-600 leading-relaxed">{s.note}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </section>

      <section className="bg-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
          <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Ways to collaborate</h2>
          <p className="text-gray-600 max-w-2xl mb-8">
            Channels and deliverables are agreed individually, to fit your event. We can&apos;t promise ticket sales,
            attendance, positive coverage or a particular reach — what we offer is honest, useful information in front
            of people who are likely to care.
          </p>
          <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 list-none p-0">
            {WAYS.map((w, i) => (
              <li key={w.title} className="rounded-2xl border border-gray-100 bg-warm p-5">
                <div className="text-2xl mb-2" aria-hidden="true">{w.icon}</div>
                <h3 className="font-bold text-gray-900 mb-1"><span className="sr-only">{i + 1}. </span>{w.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{w.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {coverage.length > 0 && (
        <section id="coverage" className="max-w-5xl mx-auto px-4 sm:px-6 py-14 scroll-mt-4">
          <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Selected coverage</h2>
          <p className="text-gray-600 max-w-2xl mb-8">
            A few recent articles, as examples of our editorial work. Featuring an event or organizer here does not
            mean they are an official Smileys partner.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {coverage.map(c => (
              <Link key={c.slug} href={`/posts/${c.slug}`} className="group block bg-white rounded-2xl border border-gray-100 overflow-hidden hover:border-amber-200 hover:shadow-md transition-all">
                {c.coverImage ? (
                  <img src={previewUrl(c.coverImage, 800)} alt="" loading="lazy" decoding="async" className="w-full h-44 object-cover" />
                ) : (
                  <div className="w-full h-44 bg-amber-50 flex items-center justify-center text-4xl" aria-hidden="true">📰</div>
                )}
                <div className="p-5">
                  <h3 className="font-bold text-gray-900 group-hover:text-amber-700 transition-colors leading-snug mb-2">{c.title}</h3>
                  {c.excerpt && <p className="text-sm text-gray-600 line-clamp-3">{c.excerpt}</p>}
                  <span className="inline-block mt-3 text-sm font-semibold text-amber-700">Read the article →</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {caseStudies.length > 0 && (
        <section id="results" className="bg-white border-y border-gray-100">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
            <h2 className="text-2xl font-extrabold text-gray-900 mb-8">Results and case studies</h2>
            <div className="space-y-5">
              {caseStudies.map(c => (
                <article key={c.title} className="rounded-2xl border border-gray-100 bg-warm p-5 sm:p-6">
                  <h3 className="font-bold text-gray-900">{c.title}</h3>
                  {c.organizer && <p className="text-xs text-gray-500 mb-3">{c.organizer} · Reporting period: {c.period}</p>}
                  <dl className="text-sm text-gray-700 space-y-2">
                    <div><dt className="inline font-semibold">Objective: </dt><dd className="inline">{c.objective}</dd></div>
                    <div><dt className="inline font-semibold">What we published or organized: </dt><dd className="inline">{c.published}</dd></div>
                    {c.channels.length > 0 && <div><dt className="inline font-semibold">Distribution: </dt><dd className="inline">{c.channels.join(', ')}</dd></div>}
                  </dl>
                  <ul className="mt-3 flex flex-wrap gap-2 list-none p-0 text-xs">
                    {c.views !== undefined && <li className="px-3 py-1 rounded-full bg-white border border-gray-200"><b>{nf.format(c.views)}</b> measured views</li>}
                    {c.ticketClicks !== undefined && <li className="px-3 py-1 rounded-full bg-white border border-gray-200"><b>{nf.format(c.ticketClicks)}</b> ticket-link clicks</li>}
                    {c.redemptions !== undefined && <li className="px-3 py-1 rounded-full bg-white border border-gray-200"><b>{nf.format(c.redemptions)}</b> redemptions</li>}
                    {c.attendance !== undefined && <li className="px-3 py-1 rounded-full bg-white border border-gray-200"><b>{nf.format(c.attendance)}</b> attended</li>}
                  </ul>
                  {c.feedback && (
                    <blockquote className="mt-4 border-l-4 border-amber-400 pl-4 text-sm text-gray-700">
                      “{c.feedback.quote}”{c.feedback.by && <footer className="text-xs text-gray-500 mt-1">— {c.feedback.by}</footer>}
                    </blockquote>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <section id="enquire" className="max-w-2xl mx-auto px-4 sm:px-6 py-14 scroll-mt-4">
        <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Discuss a partnership</h2>
        <p className="text-gray-600 mb-6">
          Tell us about your event and what you have in mind. You can also write to{' '}
          <a href={`mailto:${PARTNER_CONTACT_EMAIL}`} className="text-amber-700 font-medium underline">{PARTNER_CONTACT_EMAIL}</a>.
        </p>
        <PartnersEnquiryForm options={COLLAB_TYPES} />
        <p className="text-sm text-gray-600 mt-6 text-center">
          Looking for sponsorship or advertising instead? See <Link href="/advertise" className="text-amber-700 font-medium underline">Advertise with us</Link>.
          Want to attend events as a member? <Link href="/apply" className="text-amber-700 font-medium underline">Apply to join</Link>.
        </p>
      </section>
    </div>
  )
}
