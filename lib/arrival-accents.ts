// One soft tint per way of arriving, so the "How are you coming?" strip on the
// landing page scans at a glance instead of four identical grey cards. Keyed
// on the hub's path segment (/visiting, /remote-work, /moving, /students) —
// the only stable identifier the cards have; they are an inline array on the
// page, not rows.
//
// Every class is written out in full. Tailwind only ships utilities it can see
// statically, and the safelist in tailwind.config.js covers bg-/text- but not
// border-, ring- or hover: variants — so `border-${hue}-200` would render no
// border at all in production.
//
// Amber stays the Join button's colour: the remote-work card borrows the hue
// at tints (50/200/400) that never compete with the solid bg-amber-500 CTA.

export type ArrivalAccent = {
  /** Card surface: tint, resting border, hover border. */
  card:     string
  /** The 56px white tile behind the emoji. */
  iconWrap: string
  /** Card title. */
  title:    string
  /** The "Plan your visit →" line. */
  link:     string
}

export const ARRIVAL_HUBS = ['visiting', 'remote-work', 'moving', 'students'] as const
export type ArrivalHub = typeof ARRIVAL_HUBS[number]

export const DEFAULT_ACCENT: ArrivalAccent = {
  card:     'bg-slate-50 border-slate-200 hover:border-slate-400',
  iconWrap: 'bg-white ring-1 ring-slate-200',
  title:    'text-slate-900',
  link:     'text-slate-700',
}

export const ARRIVAL_ACCENTS: Record<ArrivalHub, ArrivalAccent> = {
  visiting: {
    card:     'bg-sky-50 border-sky-200 hover:border-sky-400',
    iconWrap: 'bg-white ring-1 ring-sky-200',
    title:    'text-sky-900',
    link:     'text-sky-700',
  },
  'remote-work': {
    card:     'bg-amber-50 border-amber-200 hover:border-amber-400',
    iconWrap: 'bg-white ring-1 ring-amber-200',
    title:    'text-amber-900',
    link:     'text-amber-700',
  },
  moving: {
    card:     'bg-emerald-50 border-emerald-200 hover:border-emerald-400',
    iconWrap: 'bg-white ring-1 ring-emerald-200',
    title:    'text-emerald-900',
    link:     'text-emerald-700',
  },
  students: {
    card:     'bg-violet-50 border-violet-200 hover:border-violet-400',
    iconWrap: 'bg-white ring-1 ring-violet-200',
    title:    'text-violet-900',
    link:     'text-violet-700',
  },
}

/** The accent for a hub, or the slate fallback for anything not in the map. */
export function arrivalAccent(hub: string): ArrivalAccent {
  return (ARRIVAL_ACCENTS as Record<string, ArrivalAccent | undefined>)[hub] ?? DEFAULT_ACCENT
}
