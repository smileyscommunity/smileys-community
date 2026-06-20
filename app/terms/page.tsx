import Link from 'next/link'

export const metadata = {
  title: 'Terms of Service — Smileys Community',
  description: 'The rules and expectations for using Smileys Community.',
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

export default function TermsPage() {
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
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-3">Terms of Service</h1>
          <p className="text-gray-600 text-sm">Last updated: {LAST_UPDATED}</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14">

        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 mb-10 text-sm text-amber-800 leading-relaxed">
          <strong>Plain-language summary:</strong> Smileys is a private, application-based social community. By joining, you agree to treat other members with respect, honour your RSVPs, and follow our community standards. We reserve the right to remove anyone who doesn't uphold these values — no refunds on paid events in that case.
        </div>

        <Section title="1. Acceptance of terms">
          <p>By applying to join, creating an account, or using any part of the Smileys Community platform ("Smileys", "the platform", "the service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree, do not use the platform.</p>
          <p>These Terms form a binding agreement between you and Smileys Community, a company incorporated in New Jersey, United States.</p>
        </Section>

        <Section title="2. Eligibility">
          <p>To use Smileys you must:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li>Be at least 18 years old</li>
            <li>Have submitted a membership application and received written approval from our team</li>
            <li>Provide accurate and truthful information during the application and registration process</li>
            <li>Not be a person previously removed or banned from the community</li>
          </ul>
          <p>Membership is granted at our sole discretion. Approval of an application does not guarantee permanent membership.</p>
        </Section>

        <Section title="3. Your account">
          <p>You are responsible for maintaining the confidentiality of your login credentials. You must not share your account with anyone else or allow others to access the platform on your behalf.</p>
          <p>You agree to provide accurate, current, and complete information about yourself and to keep your profile up to date. Profiles found to contain false information — including fake photos, false nationality, or misrepresented identity — are grounds for immediate removal.</p>
          <p>You must notify us promptly if you become aware of any unauthorised use of your account.</p>
        </Section>

        <Section title="4. Community standards">
          <p>Smileys is a curated community built on trust and mutual respect. All members are expected to:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li>Treat every member with respect — at events, in messages, and on the platform</li>
            <li>Honour the inclusive nature of the community regardless of nationality, gender, religion, or background</li>
            <li>Represent themselves honestly in their profile and interactions</li>
            <li>Respect the privacy of other members — do not share, publish, or distribute information about other members without their consent</li>
            <li>Respect event formats — including gender-balance policies, capacity limits, and host decisions</li>
          </ul>
          <p>We do not tolerate harassment, discrimination, threatening behaviour, unsolicited romantic or sexual contact, or any conduct that makes other members feel unsafe or unwelcome.</p>
        </Section>

        <Section title="5. Events and RSVPs">
          <p><strong>RSVPs are a commitment.</strong> When you RSVP to an event, you are reserving a spot that could have gone to another member. We ask that you:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li>Only RSVP if you genuinely intend to attend</li>
            <li>Cancel as early as possible if your plans change — at least 24 hours before the event where possible</li>
            <li>Not leave events early without informing the host</li>
          </ul>
          <p><strong>Repeated no-shows</strong> without cancellation may result in loss of RSVP privileges or membership review.</p>
          <p><strong>Paid events:</strong> Fees for paid events are charged to secure your spot. Refunds are provided at the host's discretion for cancellations made with reasonable notice (typically 48 hours or more). No refunds are issued for no-shows or same-day cancellations. Events cancelled by Smileys are fully refunded.</p>
          <p><strong>Behaviour at events:</strong> Hosts have the authority to ask any member to leave an event. Members asked to leave forfeit any fees paid and may be subject to membership review.</p>
        </Section>

        <Section title="6. Clubs">
          <p>Clubs are interest-based groups within the Smileys community. By joining a club you agree to participate in good faith and respect the norms of that group.</p>
          <p>Club hosts may set their own rules and remove members from their club at their discretion. Removal from a club is not the same as removal from Smileys, unless the conduct that led to removal also violates these Terms.</p>
        </Section>

        <Section title="7. Content you post">
          <p>You retain ownership of any content you upload to the platform, including your profile photo and bio. By uploading content, you grant Smileys a non-exclusive, royalty-free licence to display that content within the platform for the purpose of providing the service.</p>
          <p>You must not post content that is:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li>False, misleading, or impersonating another person</li>
            <li>Offensive, defamatory, or harmful to other members</li>
            <li>Sexually explicit or violent</li>
            <li>In violation of any applicable law</li>
            <li>Promotional or commercial without prior approval from Smileys</li>
          </ul>
          <p>We reserve the right to remove any content that violates these standards without notice.</p>
        </Section>

        <Section title="8. Prohibited conduct">
          <p>The following are strictly prohibited and will result in immediate removal from the community:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li>Harassment, threats, or intimidation of any member or staff member</li>
            <li>Creating a fake profile or misrepresenting your identity</li>
            <li>Using the platform to solicit, recruit, or commercially promote without permission</li>
            <li>Sharing another member's personal information without their consent</li>
            <li>Attempting to circumvent our application or vetting process</li>
            <li>Abusing the platform's technical infrastructure or attempting to gain unauthorised access</li>
            <li>Any conduct that damages the reputation or safety of the Smileys community</li>
          </ul>
        </Section>

        <Section title="9. Enforcement and removal">
          <p>Smileys operates a curated community and reserves the right to suspend or permanently remove any member at any time, for any reason that violates the spirit or letter of these Terms — including conduct at events, behaviour toward other members, or activity outside the platform that we become aware of.</p>
          <p>Members who are removed for misconduct are not entitled to refunds on paid events or membership fees.</p>
          <p>We may, but are not obligated to, issue warnings before taking action. Decisions on membership are made by our moderation team and are final.</p>
          <p>If you believe a removal decision was made in error, you may submit a written appeal through our <Link href="/contact" className="text-amber-600 hover:underline">contact form</Link>. We will review it within 7 days.</p>
        </Section>

        <Section title="10. Intellectual property">
          <p>All content on the Smileys platform that is not posted by members — including our name, logo, design, software, and text — is owned by or licensed to Smileys Community. You may not copy, reproduce, or use any of it without our prior written consent.</p>
        </Section>

        <Section title="11. Privacy">
          <p>Your use of Smileys is also governed by our <Link href="/privacy" className="text-amber-600 hover:underline">Privacy Policy</Link>, which is incorporated into these Terms by reference.</p>
        </Section>

        <Section title="12. Disclaimers">
          <p>Smileys provides the platform and organises events on a best-efforts basis. We do not guarantee that:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li>The platform will be available at all times or free of errors</li>
            <li>Any particular event will take place (events may be cancelled due to low attendance, host unavailability, or circumstances beyond our control)</li>
            <li>Connections or friendships made through the platform will meet your expectations</li>
          </ul>
          <p>To the fullest extent permitted by law, Smileys disclaims all warranties, express or implied, in relation to the platform and its services.</p>
        </Section>

        <Section title="13. Limitation of liability">
          <p>To the maximum extent permitted by applicable law, Smileys Community shall not be liable for any indirect, incidental, special, or consequential damages arising out of or related to your use of the platform or attendance at events, including personal injury, property damage, or loss of data.</p>
          <p>Our total liability to you for any claim arising under these Terms shall not exceed the amount you paid to Smileys in the 12 months preceding the claim.</p>
        </Section>

        <Section title="14. Changes to these terms">
          <p>We may update these Terms from time to time. When we make material changes, we will notify members via email or an in-app notice with at least 14 days' notice before the changes take effect. Continued use of the platform after that date constitutes acceptance of the updated Terms.</p>
          <p>The date at the top of this page reflects when these Terms were last updated.</p>
        </Section>

        <Section title="15. Governing law">
          <p>These Terms are governed by and construed in accordance with the laws of the State of New Jersey, United States, without regard to conflict of law principles. Any disputes shall be subject to the exclusive jurisdiction of the courts of New Jersey.</p>
          <p>If you are located in the EU and believe your statutory rights have been affected, you retain the right to bring a claim before the courts of your country of residence.</p>
        </Section>

        <Section title="16. Contact">
          <p>For questions about these Terms, use our <Link href="/contact" className="text-amber-600 hover:underline">contact form</Link>.</p>
        </Section>

      </div>

      {/* Footer nav */}
      <div className="border-t border-gray-100 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-gray-400">
          <p>© 2026 Smileys Community. All rights reserved.</p>
          <div className="flex gap-5">
            <Link href="/privacy" className="hover:text-gray-600 transition-colors">Privacy</Link>
            <Link href="/terms" className="text-amber-600 font-medium">Terms</Link>
            <Link href="/contact" className="hover:text-gray-600 transition-colors">Contact</Link>
          </div>
        </div>
      </div>

    </main>
  )
}
