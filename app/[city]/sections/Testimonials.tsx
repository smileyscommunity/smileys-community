import { resolveImageUrl } from '@/lib/data'
import type { CityPageData } from '../data'

// Member quotes. No member-count gate here any more: the query itself is now
// the honest filter. A quote reaches this page only if it belongs to this
// city or was deliberately marked across-Smileys, so a brand-new city shows
// nothing until someone says something about it.
export default function Testimonials({ testimonials }: { testimonials: CityPageData['testimonials'] }) {
  if (testimonials.length === 0) return null
  return (
    <section className="py-12 sm:py-16 bg-gray-50 border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h2 className="section-title">Life happens offline</h2>
          <p className="section-subtitle">Real stories from real members.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {testimonials.map(t => (
            <div key={t.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-sm text-gray-600 leading-relaxed mb-4 italic">"{t.quote}"</p>
              <div className="flex items-center gap-3">
                {t.photo ? (
                  <img src={resolveImageUrl(t.photo)} alt={t.memberName} className="w-11 h-11 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-11 h-11 rounded-full shrink-0 bg-amber-500 flex items-center justify-center text-white text-sm font-bold">
                    {t.memberName[0]}
                  </div>
                )}
                <div>
                  <p className="text-xs font-bold text-gray-900">{t.memberName}</p>
                  {t.role && <p className="text-xs text-gray-400">{t.role}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
