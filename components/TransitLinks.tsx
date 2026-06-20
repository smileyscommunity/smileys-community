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

  // h-full so the card stretches to fill its grid cell. Without it,
  // a row whose tallest card has a `tip` leaves the shorter (no-tip)
  // cards short, and the page-bg shows through below them — reading
  // as a gap between adjacent cards in the same column.
  // Content (title, description, CTA) packs to the top; any slack
  // from row-stretching falls below the CTA inside the bg-white
  // card, which reads as padding rather than a gap.
  const cardBody = (
    <div className={`relative bg-white rounded-2xl p-4 shadow-sm transition-all overflow-hidden h-full flex flex-col
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
      <p className="text-sm text-gray-600 leading-relaxed">{r.description}</p>
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

  // Flex column so cardBody can flex-1 and stretch to fill the grid
  // cell height (the actual gap fix), and secondaryHref stays as a
  // shrink-0 row below. `group` only when r.href — without a Link or
  // anchor wrapping cardBody, group-hover descendants have nothing
  // to react to, so the marker class is dead weight.
  return (
    <div className={`relative h-full flex flex-col ${r.href ? 'group' : ''}`}>
      {r.href ? (
        r.href.startsWith('/')
          ? <Link href={r.href} className="block flex-1">{cardBody}</Link>
          : <a href={r.href} target="_blank" rel="noopener noreferrer" className="block flex-1">{cardBody}<span className="sr-only"> (opens in a new tab)</span></a>
      ) : <div className="flex-1">{cardBody}</div>}
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
    <div className="space-y-10">
      {categories.map(cat => (
        <section key={cat.label} id={categoryId(cat.label)} className="scroll-mt-16">
          {/* Section header — title row + meta row. Split into two
              rows so a long label and a long "Updated" date can't
              collide on mobile. Previous flexbox-everything-on-one-row
              version overlapped on the Co-working and Practical Info
              sections at iPhone width. */}
          <div className="mb-4">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${cat.color} shrink-0`}>
                {cat.icon}
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight leading-tight">
                {cat.label}
              </h2>
            </div>
            <div className="mt-2 ml-[52px] flex items-center gap-3 text-xs text-gray-400 font-medium">
              <span>{cat.resources.length} {cat.resources.length === 1 ? 'item' : 'items'}</span>
              {cat.updatedAt && (
                <>
                  <span className="text-gray-300">·</span>
                  <span>Updated {new Date(cat.updatedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span>
                </>
              )}
            </div>
          </div>

          {/* Resources grid — semantic <ul> so SR users get a list-of-N
              announcement and can navigate with the list rotor. The
              grid styling stays via Tailwind utilities; list-none kills
              the default disc/decimal marker. */}
          <ul className="list-none p-0 m-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {cat.resources.map(r => (
              <li key={r.title}>
                <ResourceCard r={r} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export type { Category, Resource }
