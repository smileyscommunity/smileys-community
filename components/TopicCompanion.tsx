import Link from 'next/link'

// "Go deeper" / "Start with the overview" card between a story and the
// Handbook guide on the same topic (lib/topicPairs).
export default function TopicCompanion({ href, kicker, title, excerpt }: { href: string; kicker: string; title: string; excerpt?: string | null }) {
  return (
    <section className="mt-12 pt-8 border-t border-gray-100">
      <Link href={href} className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-amber-300 transition-colors group">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1">{kicker}</p>
        <h3 className="text-sm font-extrabold text-gray-900 group-hover:text-amber-600 transition-colors leading-tight mb-1">{title}</h3>
        {excerpt && <p className="text-xs text-gray-600 line-clamp-2">{excerpt}</p>}
      </Link>
    </section>
  )
}
