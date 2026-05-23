export const metadata = {
  title: 'Cookie Policy — Smileys Community',
  description: 'How Smileys Community uses cookies and similar technologies.',
}

const LAST_UPDATED = 'May 2026'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold text-gray-900 mb-4">{title}</h2>
      <div className="space-y-3 text-gray-600 leading-relaxed text-sm">{children}</div>
    </section>
  )
}

export default function CookiePolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Cookie Policy</h1>
        <p className="text-sm text-gray-400">Last updated: {LAST_UPDATED}</p>
      </div>

      <Section title="What are cookies?">
        <p>
          Cookies are small text files stored on your device when you visit a website. They allow the site to remember information about your visit — like whether you're signed in — so you don't have to re-enter it every time.
        </p>
      </Section>

      <Section title="Cookies we use">
        <p><strong className="text-gray-800">Essential cookies</strong> — These are required for the platform to function. They include:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><code className="text-xs bg-gray-100 px-1 py-0.5 rounded">smileys_session</code> — keeps you signed in across pages. HttpOnly, Secure, SameSite=Lax. Expires after 30 days of inactivity.</li>
        </ul>
        <p className="mt-3">You cannot opt out of essential cookies without losing access to member features.</p>

        <p className="mt-4"><strong className="text-gray-800">Analytics cookies</strong> — If you accept all cookies, we may collect anonymised data about how pages are used (page views, session duration) to help us improve the platform. No personal data is shared with third parties for advertising purposes.</p>
      </Section>

      <Section title="Your choices">
        <p>
          When you first visit Smileys Community, a banner gives you the option to accept all cookies or limit to essential cookies only. You can change your preference at any time by clearing your browser's site data for <strong className="text-gray-800">smileyscommunity.com</strong> — the banner will reappear on your next visit.
        </p>
      </Section>

      <Section title="Third-party cookies">
        <p>
          We do not use third-party advertising cookies or tracking pixels. Any external services we embed (e.g. maps for event locations) may set their own cookies subject to their own policies.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about this policy? Email us at{' '}
          <a href="mailto:hello@smileyscommunity.com" className="text-amber-600 hover:underline">
            hello@smileyscommunity.com
          </a>
          .
        </p>
      </Section>
    </div>
  )
}
