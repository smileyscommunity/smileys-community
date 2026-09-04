import Link from 'next/link'
import { readFileSync } from 'fs'
import { join } from 'path'

export const metadata = {
  title: 'Community Guidelines — Smileys Community',
  description: 'The behavioral rules that keep Smileys safe, kind, and worth showing up for. Read these before joining a club or RSVP\'ing to an event.',
}

const LAST_UPDATED = 'June 2026'

interface CommunityRule { title: string; body: string }

function loadCommunityRules(): CommunityRule[] {
  try {
    const settings = JSON.parse(readFileSync(join(process.cwd(), 'data', 'settings.json'), 'utf-8'))
    return Array.isArray(settings.communityRules) ? settings.communityRules : []
  } catch { return [] }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold text-gray-900 mb-4">{title}</h2>
      <div className="space-y-3 text-gray-600 leading-relaxed text-sm">{children}</div>
    </section>
  )
}

function Rule({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-4 border-amber-300 bg-amber-50/40 pl-4 py-3 rounded-r-xl">
      <p className="font-semibold text-gray-900 mb-1">
        <span className="mr-1.5">{icon}</span>
        {title}
      </p>
      <p className="text-sm text-gray-600 leading-relaxed">{children}</p>
    </div>
  )
}

export default function GuidelinesPage() {
  const communityRules = loadCommunityRules()

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
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-3">Community Guidelines</h1>
          <p className="text-gray-600 text-sm">Last updated: {LAST_UPDATED}</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14">
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 mb-10 text-sm text-amber-800 leading-relaxed">
          <p className="font-semibold mb-1">The short version</p>
          <p>
            Smileys is a curated community for people building real friendships in our cities.
            Be kind, be honest, show up when you say you will, and treat every member like
            someone you might meet for coffee tomorrow — because you probably will. These
            guidelines exist so the rare bad actor doesn't ruin it for everyone else.
          </p>
        </div>

        {communityRules.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Community Rules</h2>
            <ol className="space-y-3">
              {communityRules.map((rule, i) => (
                <li key={i} className="flex gap-4 border-l-4 border-amber-400 bg-amber-50/40 pl-4 py-3 rounded-r-xl">
                  <span className="text-amber-500 font-extrabold text-sm shrink-0 mt-0.5 w-5">{i + 1}.</span>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{rule.title}</p>
                    <p className="text-sm text-gray-600 leading-relaxed mt-0.5">{rule.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        <Section title="What we expect from every member">
          <div className="space-y-3">
            <Rule icon="🤝" title="Be kind, even when you disagree">
              Debate ideas, not people. Sarcasm and edge are fine in the right tone; personal
              attacks, slurs, and pile-ons are not. Disagreement is welcome — disrespect isn't.
            </Rule>
            <Rule icon="📅" title="Show up when you RSVP">
              Other members are counting on you. If something comes up, cancel as early as you
              can so your spot frees up. Repeat no-shows hurt the host's ability to run good
              events and may pause your access.
            </Rule>
            <Rule icon="🎯" title="Keep posts on-topic and useful">
              Club walls, event chats, and the neighborhood feed are for connection, not
              promotion. Sharing a side project once is fine; spamming every channel isn't.
            </Rule>
            <Rule icon="🔒" title="Respect what's said in private">
              What members share in a private club or DM stays there. Don't screenshot, forward,
              or quote without consent — same rules you'd follow in any in-person friend group.
            </Rule>
            <Rule icon="🙅" title="No harassment, hate, or unwanted advances">
              Smileys is not a dating app. Members aren't here to be hit on. Any pattern of
              unwanted DMs, persistent flirting after a "no thanks," or sexual / racist / hateful
              content is grounds for immediate removal.
            </Rule>
          </div>
        </Section>

        <Section title="Hosting events">
          <p>
            Hosts have a higher bar — members trust you with their evening.
          </p>
          <div className="space-y-3 mt-3">
            <Rule icon="✅" title="Be accurate about what you're hosting">
              Title, description, neighborhood, capacity, time, price — if it changes after
              people RSVP, message the attendees. Don't bait-and-switch a "coffee meetup" into
              a sales pitch.
            </Rule>
            <Rule icon="💸" title="No hidden costs">
              Member-priced events get the discount they're advertised at. Optional purchases
              at the venue (drinks, food) are fine to mention up front — surprise cover charges
              are not.
            </Rule>
            <Rule icon="🚫" title="No selling, no recruiting, no MLM">
              Events that exist primarily to sell a course, a coaching package, a crypto thing,
              or an MLM downline aren't allowed. We'll refund attendees and pause your hosting
              access.
            </Rule>
          </div>
        </Section>

        <Section title="Posting in the Business Directory">
          <div className="space-y-3">
            <Rule icon="📍" title="Submit places you've actually been">
              Add businesses you know — your favourite café, your physio, the friend's gallery.
              Don't pad the directory with rumours or competitor listings you've never visited.
            </Rule>
            <Rule icon="⭐" title="Reviews are honest first-hand experience">
              One member, one review, with the rating that matches what you'd tell a friend.
              No fake-positive reviews of your own business, no revenge reviews of a place you
              had one bad encounter with.
            </Rule>
            <Rule icon="🪪" title="Only claim a business you actually own or operate">
              The "Is this your business?" flow verifies ownership. Claiming someone else's
              listing to manipulate it is a permanent ban offence.
            </Rule>
          </div>
        </Section>

        <Section title="Content you share">
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li>No content that targets people by race, religion, gender, sexuality, nationality, or disability.</li>
            <li>No promotion of violence, self-harm, illegal drugs, or weapons.</li>
            <li>No sexually explicit content — Smileys is a mixed-audience community space.</li>
            <li>No political party campaigning or organized political mobilization (per local law and our community focus on social life). Personal views shared respectfully are fine.</li>
            <li>No deepfakes, manipulated images of real people, or impersonation.</li>
          </ul>
        </Section>

        <Section title="When something goes wrong">
          <p>
            We're a small team and we're not always watching every channel in real time. Help
            us by flagging things:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-2 mt-2">
            <li>
              <strong className="text-gray-800">Bad behaviour in an event or chat</strong> —
              message a host or use the report link on the offending post / member.
            </li>
            <li>
              <strong className="text-gray-800">A directory listing that's wrong</strong> —
              hit "Report a problem" on the business card.
            </li>
            <li>
              <strong className="text-gray-800">A safety concern</strong> — email{' '}
              <a href="mailto:info@smileyscommunity.com" className="text-amber-700 hover:underline">
                info@smileyscommunity.com
              </a>
              {' '}directly. We treat these as priority.
            </li>
          </ul>
        </Section>

        <Section title="How we enforce">
          <p>
            We try to start with a conversation. For most first-time issues we'll reach out and
            ask the member to adjust. From there, in increasing order of severity:
          </p>
          <ol className="list-decimal list-inside space-y-2 ml-2 mt-3">
            <li>A direct warning from a moderator with a specific ask.</li>
            <li>Temporary pause on hosting, RSVPing, or posting (typically 7–30 days).</li>
            <li>Removal of specific content (post, review, listing, club post).</li>
            <li>
              Permanent account removal. Reserved for harassment, hate, repeat violations,
              fraud, and anything that endangers another member.
            </li>
          </ol>
          <p className="mt-3">
            Serious or unambiguous violations (threats, hate, sexual misconduct, fraud) skip the
            warning step. Appeals go to{' '}
            <a href="mailto:info@smileyscommunity.com" className="text-amber-700 hover:underline">
              info@smileyscommunity.com
            </a>
            ; we review every appeal and respond within 5 business days, but reserve the right to decline reinstatement.
          </p>
        </Section>

        <Section title="Things that aren't community guidelines but related">
          <p>
            Some questions are governed by other documents:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2 mt-2">
            <li>
              <Link href="/terms" className="text-amber-700 hover:underline">Terms of use</Link>
              {' '}— your account, payments, refunds, IP.
            </li>
            <li>
              <Link href="/privacy" className="text-amber-700 hover:underline">Privacy policy</Link>
              {' '}— what data we collect, how we use it, your rights.
            </li>
            <li>
              <Link href="/cookies" className="text-amber-700 hover:underline">Cookie policy</Link>
              {' '}— what runs in your browser and why.
            </li>
          </ul>
        </Section>

        <Section title="Changes to these guidelines">
          <p>
            The community grows, the rules evolve. When we update these guidelines we'll bump
            the "Last updated" date at the top. Material changes (new categories of violation,
            new enforcement steps) will also be announced on the main Smileys dashboard feed so you're not
            surprised.
          </p>
        </Section>

        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5 mt-12 text-sm text-gray-600 leading-relaxed text-center">
          Got a question about these guidelines? Reach out at{' '}
          <a href="mailto:info@smileyscommunity.com" className="text-amber-700 hover:underline font-medium">
            info@smileyscommunity.com
          </a>
          {' '}— we read every email.
        </div>
      </div>
    </main>
  )
}
