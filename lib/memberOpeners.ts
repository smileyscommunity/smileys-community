// Contextual conversation openers (Members brief §29) — pure logic, kept
// out of the component file so tests can import it without JSX handling.
// Shape mirrors the shared-context payload the profile API returns.
export interface ProfileSharedContext {
  clubs:        { id: string; name: string; emoji: string; slug: string }[]
  neighborhood: string | null
  events:       { id: string; title: string; date: string; emoji: string }[]
  hangouts:     { id: string; title: string }[]
  interests:    string[]
}

// At most three, strongest context first. Returns nothing when there's no
// real overlap — a generic "hi there" suggestion would defeat the point.
export function suggestedOpeners(ctx: ProfileSharedContext | null, firstName: string): string[] {
  if (!ctx) return []
  const out: string[] = []
  if (ctx.clubs.length > 0) out.push(`Hey ${firstName}! We're both in ${ctx.clubs[0].name} 👋`)
  if (ctx.events.length > 0) out.push(`Looks like we're both going to ${ctx.events[0].title} — see you there!`)
  if (ctx.neighborhood) out.push(`I'm also around ${ctx.neighborhood}. Any favourite coffee spots?`)
  if (ctx.interests.length > 0 && out.length < 3) out.push(`Saw you're into ${ctx.interests[0]} too — what got you started?`)
  return out.slice(0, 3)
}
