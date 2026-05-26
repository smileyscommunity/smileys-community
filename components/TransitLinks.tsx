import Link from 'next/link'

interface Resource {
  title: string
  description: string
  href?: string
  hrefLabel?: string
  secondaryHref?: string
  secondaryHrefLabel?: string
  badge?: string
  badgeColor?: string
  tip?: string
}

interface Category {
  icon: string
  label: string
  color: string
  // ISO date — surfaced as "Updated Mon YYYY" so members can tell whether
  // visa/banking/tax info is current. Optional; categories without it just
  // don't show a stamp.
  updatedAt?: string
  resources: Resource[]
}

export function categoryId(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function ResourceCard({ r }: { r: Resource }) {
  const isEssential = r.badge?.toLowerCase() === 'essential'

  const cardBody = (
    <div className={`relative bg-white rounded-2xl p-4 shadow-sm transition-all overflow-hidden
      ${r.href ? 'hover:shadow-md hover:border-amber-200' : ''}
      ${isEssential ? 'border border-amber-200 ring-1 ring-amber-100' : 'border border-gray-100'}`}>
      {isEssential && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-400 to-orange-400" />
      )}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className={`text-sm font-semibold text-gray-900 leading-snug ${r.href ? 'group-hover:text-amber-700 transition-colors' : ''}`}>
          {r.title}
        </span>
        {r.badge && (
          <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${r.badgeColor ?? 'bg-amber-100 text-amber-700'}`}>
            {r.badge}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 leading-relaxed">{r.description}</p>
      {r.tip && (
        <p className="mt-2.5 text-sm text-amber-700 bg-amber-50 rounded-xl px-2.5 py-2 leading-relaxed">
          💡 {r.tip}
        </p>
      )}
      {r.href && (
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
          {r.hrefLabel ?? (r.href.startsWith('/') ? 'View guide →' : 'Open ↗')}
        </span>
      )}
    </div>
  )

  return (
    <div className="group relative">
      {r.href ? (
        r.href.startsWith('/')
          ? <Link href={r.href} className="block">{cardBody}</Link>
          : <a href={r.href} target="_blank" rel="noopener noreferrer" className="block">{cardBody}</a>
      ) : cardBody}
      {r.secondaryHref && (
        <div className="mt-1.5 px-1">
          <Link href={r.secondaryHref}
            className="text-xs font-medium text-gray-400 hover:text-amber-600 transition-colors">
            {r.secondaryHrefLabel ?? 'See events →'}
          </Link>
        </div>
      )}
    </div>
  )
}

export default function TransitLinks({ categories }: { categories: Category[] }) {
  return (
    <div className="space-y-14">
      {categories.map((cat, i) => (
        <section key={cat.label} id={categoryId(cat.label)}>
          {/* Section header */}
          <div className="flex items-center gap-3 mb-5">
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg ${cat.color} shrink-0`}>
              {cat.icon}
            </span>
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest flex-1">{cat.label}</h2>
            {cat.updatedAt && (
              <span className="text-xs font-medium text-gray-400 shrink-0">
                Updated {new Date(cat.updatedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
              </span>
            )}
            <span className="text-xs font-medium text-gray-400 shrink-0">
              {cat.resources.length} {cat.resources.length === 1 ? 'item' : 'items'}
            </span>
          </div>

          {/* Resources grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {cat.resources.map(r => <ResourceCard key={r.title} r={r} />)}
          </div>

          {/* Section divider (not on last) */}
          {i < categories.length - 1 && (
            <div className="mt-14 border-t border-gray-100" />
          )}
        </section>
      ))}
    </div>
  )
}

export type { Category, Resource }
