import Link from 'next/link'

export const metadata = {
  title: 'Privacy Policy — Smileys Community',
  description: 'How Smileys Community collects, uses, and protects your personal data.',
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

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white">

      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-amber-600 transition-colors mb-6">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Smileys Community
          </Link>
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-3">Privacy Policy</h1>
          <p className="text-gray-600 text-sm">Last updated: {LAST_UPDATED}</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14">

        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 mb-10 text-sm text-amber-800 leading-relaxed">
          <strong>Summary:</strong> Smileys Community collects only the information needed to run a safe, curated social community. We do not sell your data. We do not share it with advertisers. You can request deletion of your account and data at any time.
        </div>

        <Section title="1. Who we are">
          <p>Smileys Community ("Smileys", "we", "us", "our") is a company incorporated in New Jersey, United States. We operate a curated social platform that organises events, interest-based clubs, and community experiences for expats and global professionals in cities around the world. We currently operate in Istanbul, Turkey, with plans to expand to additional cities.</p>
          <p>Our members come from over 45 countries, including European Union member states. Because we actively serve EU residents, we are subject to the EU General Data Protection Regulation (GDPR) in addition to applicable US law.</p>
          <p>You can reach us through our <Link href="/contact" className="text-amber-600 hover:underline">contact page</Link>.</p>
        </Section>

        <Section title="2. What data we collect">
          <p>We collect information you provide directly when you apply to join, create an account, or use our platform:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li><strong>Identity:</strong> Full name, nationality, languages spoken</li>
            <li><strong>Contact:</strong> Email address, phone number</li>
            <li><strong>Profile:</strong> Profile photo, bio, neighborhood, interests, Instagram handle (optional), gender (optional)</li>
            <li><strong>Application data:</strong> Date of birth, profession, LinkedIn profile (optional), time living in Istanbul, and your reasons for joining — collected as part of the membership review process</li>
            <li><strong>Activity:</strong> Events you join, clubs you're a member of, RSVPs, attendance history, reviews you leave</li>
            <li><strong>Payments:</strong> Payment status and transaction records for paid events (we do not store full card details)</li>
            <li><strong>Communications:</strong> Messages you send through our contact form</li>
          </ul>
          <p>We also collect limited technical data automatically:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li>IP address (used for rate limiting and security)</li>
            <li>Browser type and device information (from standard HTTP headers)</li>
            <li>Session tokens stored as secure, httpOnly cookies</li>
          </ul>
          <p>We do <strong>not</strong> use tracking pixels, advertising cookies, or third-party analytics scripts. We operate an internal analytics dashboard for operational purposes (e.g. event attendance trends) — this data is never shared externally.</p>
        </Section>

        <Section title="3. How we use your data">
          <p>We use the data we collect to:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li>Review and process your membership application</li>
            <li>Create and manage your account</li>
            <li>Match you with relevant events, clubs, and members</li>
            <li>Send you event confirmations, reminders, and community updates</li>
            <li>Enable hosts to manage events and guest lists</li>
            <li>Maintain the safety and quality of the community (moderation)</li>
            <li>Respond to your support requests and messages</li>
            <li>Comply with legal obligations</li>
          </ul>
          <p>We do <strong>not</strong> use your data for targeted advertising, profiling for commercial purposes, or automated decision-making that has legal or significant effects on you.</p>
        </Section>

        <Section title="4. Legal framework">
          <p>Smileys Community is subject to the laws of the State of New Jersey and the United States. Because we actively serve EU residents, we are also bound by the EU General Data Protection Regulation (GDPR). Where GDPR applies, we process your personal data on the following legal bases:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li><strong>Contract:</strong> Processing necessary to provide membership, event access, and club participation</li>
            <li><strong>Legitimate interests:</strong> Community safety, moderation, fraud prevention, and platform improvement</li>
            <li><strong>Consent:</strong> Marketing communications and optional features — you may withdraw consent at any time</li>
            <li><strong>Legal obligation:</strong> Where required by applicable law</li>
          </ul>
          <p>If you are a resident of California, you may have additional rights under the California Consumer Privacy Act (CCPA). At our current scale we fall below the thresholds that trigger full CCPA obligations, but we honour those rights — including the right to know what data we hold and to request its deletion — for all members regardless of location.</p>
        </Section>

        <Section title="5. International data transfers">
          <p>Our platform serves members from over 45 countries across multiple cities. Your personal data may be transferred to and processed in countries other than your own, including the United States where we are incorporated and the countries in which we operate. We take steps to ensure that any such transfers are subject to appropriate safeguards, consistent with GDPR requirements and applicable US law.</p>
          <p>If you are located in the European Union, data transfers to third countries are carried out in accordance with Chapter V of the GDPR.</p>
        </Section>

        <Section title="6. Sharing your data">
          <p>We do not sell, rent, or trade your personal data. We share it only in the following limited circumstances:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li><strong>Other members:</strong> Your name and profile photo are visible to approved Smileys members. Your phone number and email are never publicly visible.</li>
            <li><strong>Event hosts:</strong> When you RSVP to an event, the host sees your name and profile photo for guest list management.</li>
            <li><strong>Service providers:</strong> We use Resend to deliver transactional emails. They process your email address solely to deliver messages on our behalf and are bound by data processing agreements.</li>
            <li><strong>Legal requirements:</strong> If required by law, court order, or to protect the rights and safety of our community.</li>
          </ul>
        </Section>

        <Section title="7. Data retention">
          <p>We retain your personal data for as long as your account is active. If you request account deletion, we will permanently delete your data within 30 days, except where we are required by law to retain certain records.</p>
          <p>Application data from rejected or withdrawn applications is deleted after 12 months.</p>
          <p>Server logs containing IP addresses are retained for a maximum of 90 days for security purposes.</p>
        </Section>

        <Section title="8. Your rights">
          <p>Depending on your location, you may have the following rights regarding your personal data:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li><strong>Access:</strong> Request a copy of the personal data we hold about you</li>
            <li><strong>Rectification:</strong> Correct inaccurate or incomplete data</li>
            <li><strong>Erasure:</strong> Request deletion of your data ("right to be forgotten")</li>
            <li><strong>Portability:</strong> Receive your data in a portable format</li>
            <li><strong>Objection:</strong> Object to processing based on legitimate interests</li>
            <li><strong>Restriction:</strong> Request that we restrict processing of your data</li>
            <li><strong>Withdrawal of consent:</strong> Where processing is based on consent, withdraw it at any time</li>
          </ul>
          <p>To exercise any of these rights, use our <Link href="/contact" className="text-amber-600 hover:underline">contact form</Link>. We will respond within 30 days.</p>
        </Section>

        <Section title="9. Cookies">
          <p>We use one essential cookie: a secure, httpOnly session cookie (<code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">smileys_session</code>) that keeps you logged in for up to 30 days. This cookie is strictly necessary for the platform to function and does not track you across other websites.</p>
          <p>We do not use advertising cookies, social media tracking cookies, or third-party analytics cookies.</p>
        </Section>

        <Section title="10. Security">
          <p>We take reasonable technical and organisational measures to protect your data, including:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li>Passwords stored as salted bcrypt hashes — we cannot see your password</li>
            <li>Session tokens signed with HS256 JWT and stored in httpOnly cookies</li>
            <li>HTTPS enforced across all pages</li>
            <li>Rate limiting on authentication and upload endpoints</li>
            <li>Application access restricted to approved members only</li>
          </ul>
          <p>No system is completely secure. If you discover a security vulnerability, please report it privately through our <Link href="/contact" className="text-amber-600 hover:underline">contact form</Link>.</p>
        </Section>

        <Section title="11. Children's privacy">
          <p>Smileys Community is intended for adults aged 18 and over. By applying to join or creating an account, you confirm that you are at least 18 years old. If we become aware that a minor has submitted their data, we will delete it promptly. If you believe this has occurred, please <Link href="/contact" className="text-amber-600 hover:underline">contact us</Link> and we will delete it promptly.</p>
        </Section>

        <Section title="12. Changes to this policy">
          <p>We may update this Privacy Policy from time to time. When we make significant changes, we will notify members by email or through an in-app notice. The date at the top of this page always reflects when the policy was last updated.</p>
          <p>Continued use of Smileys after changes take effect constitutes acceptance of the revised policy.</p>
        </Section>

        <Section title="13. Governing law">
          <p>This Privacy Policy is governed by and construed in accordance with the laws of the State of New Jersey, United States, without regard to conflict of law principles. Any disputes arising under this policy shall be subject to the exclusive jurisdiction of the courts of New Jersey.</p>
          <p>If you are located in the European Union or another jurisdiction with a data protection supervisory authority and believe your rights have been infringed, you have the right to lodge a complaint with your local authority.</p>
        </Section>

        <Section title="14. Contact us">
          <p>If you have any questions about this Privacy Policy or how we handle your data, please contact us:</p>
          <div className="mt-3 bg-gray-50 rounded-xl p-4 text-sm">
            <p className="font-semibold text-gray-900">Smileys Community</p>
            <p>New Jersey, United States</p>
            <p className="mt-1"><Link href="/contact" className="text-amber-600 hover:underline">Contact form →</Link></p>
          </div>
        </Section>

      </div>

      {/* Footer nav */}
      <div className="border-t border-gray-100 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-gray-400">
          <p>© 2026 Smileys Community. All rights reserved.</p>
          <div className="flex gap-5">
            <Link href="/privacy" className="text-amber-600 font-medium">Privacy</Link>
            <Link href="/contact" className="hover:text-gray-600 transition-colors">Contact</Link>
            <Link href="/about" className="hover:text-gray-600 transition-colors">About</Link>
          </div>
        </div>
      </div>

    </main>
  )
}
