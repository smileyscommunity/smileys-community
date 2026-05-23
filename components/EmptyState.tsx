import Link from 'next/link'

interface Props {
  icon?: string
  title: string
  body?: string
  action?: { label: string; href?: string; onClick?: () => void }
}

export default function EmptyState({ icon = '✨', title, body, action }: Props) {
  return (
    <div className="text-center py-20 max-w-xs mx-auto">
      <span className="text-5xl block mb-4">{icon}</span>
      <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
      {body && <p className="text-sm text-gray-500 mb-6">{body}</p>}
      {action && (
        action.href ? (
          <Link href={action.href}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors inline-block">
            {action.label}
          </Link>
        ) : (
          <button onClick={action.onClick}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
            {action.label}
          </button>
        )
      )}
    </div>
  )
}
