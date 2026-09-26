import { HOST_PATH } from '@/lib/hostTitles'

// The stated path: Host, then City Lead. One block, rendered on Meet the
// Hosts, the per-city hub and the get-involved page, so the story is the
// same wherever someone first reads it. Copy comes from lib/hostTitles.
export default function HostPath({ cityName, className = '' }: { cityName?: string; className?: string }) {
  return (
    <div className={`rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 ${className}`}>
      <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-1">The path</p>
      <h2 className="text-xl font-extrabold text-gray-900 mb-5">
        {cityName ? `How ${cityName} gets its hosts` : 'How a city gets its hosts'}
      </h2>
      <ol className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {HOST_PATH.map((step, i) => (
          <li key={step.title} className="flex gap-4">
            <span aria-hidden="true" className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-extrabold ${
              step.title === 'lead' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-700'
            }`}>{i + 1}</span>
            <div>
              <p className="font-bold text-gray-900">{step.label}</p>
              <p className="text-sm text-gray-600 mt-1">{step.how}</p>
              <p className="text-sm text-gray-500 mt-1">{step.then}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
