import Link from 'next/link'
import { jsonLdHtml } from '@/lib/jsonLd'
import { isValidElement, type ReactNode } from 'react'
import { APP_URL } from '@/lib/env'
import { loadContent } from '@/lib/content'
import FAQ_DEFAULT from '@/lib/faqDefault.json'
import { splitSiteAddresses } from '@/lib/siteAddresses'

export const revalidate = 3600

// The share card: Nate's FAQ banner (2026-09-29), cropped to 1200×630 at
// ~170KB — under WhatsApp's ~300KB silent-drop threshold — the same way as
// public/images/about-hero-og.jpg. A page-level openGraph block loses the
// root layout's og:image, so it is set here. Re-crop if the banner changes.
const ogImage = `${APP_URL}/images/faq-og.jpg`
const ogAlt   = 'Smileys Community FAQ: got questions? We’ve got answers.'

export const metadata = {
  alternates: { canonical: `${APP_URL}/faq` },
  title: 'FAQ — Smileys Community Help Centre',
  description: 'Everything you need to know about Smileys — membership, events, clubs, applications, and more.',
  openGraph: {
    title: 'Smileys Community FAQ',
    description: 'Everything you need to know about joining and using Smileys Community.',
    url: `${APP_URL}/faq`,
    images: [{ url: ogImage, width: 1200, height: 630, alt: ogAlt }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Smileys Community FAQ',
    description: 'Everything you need to know about joining and using Smileys Community.',
    images: [{ url: ogImage, alt: ogAlt }],
  },
}

interface FAQ  { q: string; a: React.ReactNode }
interface Section { id: string; icon: string; title: string; faqs: FAQ[] }

// FAQPage schema needs a plain-text answer, but a few `a` values are JSX
// (e.g. "<span>Fill in the form at <Link>...</Link>.</span>") for in-page
// links. Walk the element tree and concatenate text without rendering
// anything — safe for both a plain string and these simple span/Link shapes.
function faqAnswerText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(faqAnswerText).join('')
  if (isValidElement(node)) return faqAnswerText((node.props as { children?: ReactNode }).children)
  return ''
}

// The live answers are admin-edited text (content.json), so an address in
// one was plain text, not a link (lib/siteAddresses).
function linkify(a: ReactNode): ReactNode {
  if (typeof a !== 'string') return a
  const parts = splitSiteAddresses(a)
  if (!parts.some(p => p.href)) return a
  return parts.map((p, i) => p.href
    ? <Link key={i} href={p.href} className="text-amber-600 font-medium hover:underline">{p.text}</Link>
    : p.text)
}

// The code fallback, used only when the server's content.json has no faq.
// It is the same reviewed text the server copy was set from
// (scripts/apply-faq-content.ts lib/faqDefault.json), so a missing or
// cleared admin FAQ doesn't bring back an old, wrong set of answers.
const SECTIONS: Section[] = FAQ_DEFAULT.map(s => ({
  id: s.id, icon: s.icon, title: s.title,
  faqs: s.items.map(i => ({ q: i.q, a: i.a })),
}))

export default async function FAQPage() {
  const c = loadContent()
  const sections: Section[] = c.faq?.length > 0
    ? c.faq.map((s: any) => ({
        id:    s.id,
        icon:  s.icon,
        title: s.title,
        faqs:  s.items.map((item: any) => ({ q: item.q, a: item.a })),
      }))
    : SECTIONS

  // FAQPage rich results — every Q&A on the page, flattened across sections.
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type':    'FAQPage',
    mainEntity: sections.flatMap(s => s.faqs.map(faq => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faqAnswerText(faq.a) },
    }))),
  }

  return (
    <div className="bg-gray-50 min-h-screen">
      <script
        type="application/ld+json"
        // JSON.stringify doesn't escape `<`, so a literal `</script>` in any
        // interpolated value would break out of this tag — escape `<` plus
        // the unicode line separators (same guard as the other JSON-LD blocks).
        dangerouslySetInnerHTML={{
          __html: jsonLdHtml(faqJsonLd),
        }}
      />

      {/* Hero */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase mb-6">
            <span aria-hidden="true">❓</span> Help Centre
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
            Frequently asked questions
          </h1>
          <p className="text-base text-gray-600 max-w-lg">
            Everything you need to know about Smileys — membership, events, clubs, and more.
          </p>
        </div>

        {/* Category pills */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
          <div className="flex flex-wrap gap-2">
            {sections.map(s => (
              <a key={s.id} href={`#${s.id}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-gray-50 border border-gray-200 text-sm font-medium text-gray-600 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 transition-all">
                <span aria-hidden="true">{s.icon}</span>
                {s.title}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-16">
        {sections.map(s => (
          <section key={s.id} id={s.id}>
            {/* Section header */}
            <div className="flex items-center gap-3 mb-8">
              <div aria-hidden="true" className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-xl shrink-0">
                {s.icon}
              </div>
              <h2 className="text-2xl font-extrabold text-gray-900">{s.title}</h2>
            </div>

            {/* Q&A grid */}
            <div className="grid sm:grid-cols-2 gap-4">
              {s.faqs.map((faq, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 hover:border-amber-200 transition-colors">
                  <h3 className="text-sm font-bold text-gray-900 mb-2.5 leading-snug">{faq.q}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{linkify(faq.a)}</p>
                </div>
              ))}
            </div>
          </section>
        ))}

        {/* CTA */}
        <div className="bg-amber-500 rounded-2xl p-10 text-center">
          {/* Text on the amber card is dark: white and amber-100 on amber-500
              read at about 2:1. The button keeps its own colours. */}
          <div aria-hidden="true" className="text-3xl mb-3">💬</div>
          <h2 className="text-2xl font-extrabold text-amber-950 mb-2">Still have questions?</h2>
          <p className="text-amber-950 text-sm mb-6 max-w-sm mx-auto">
            Our team reads every message and replies by email.
          </p>
          <Link href="/contact" className="btn-white !px-7 !py-3 !text-sm">Contact us</Link>
        </div>
      </div>

    </div>
  )
}
