'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

interface WeekDay  { day: string; short: string; emoji: string; event: string; desc: string }
interface FaqItem  { q: string; a: string }
interface FaqSection { id: string; icon: string; title: string; items: FaqItem[] }
interface Content {
  stats:         { value: string; label: string }[]
  home:          { headline: string; subtitle: string }
  about:         { headline: string; subtitle: string; story_p1: string; story_p2: string; story_p3: string }
  why:           { headline: string; tagline: string; subtitle: string; closing: string }
  get_involved:  { headline: string; subtitle: string }
  advertise:     { headline: string; subtitle: string }
  week:          WeekDay[]
  faq:           FaqSection[]
  events:        { headline: string; subtitle: string; badge: string }
  clubs:         { headline: string; subtitle: string; badge: string }
  members:       { headline: string; subtitle: string; badge: string }
  neighborhoods: { headline: string; subtitle: string; badge: string }
}

type Tab = 'stats' | 'home' | 'about' | 'why' | 'get_involved' | 'advertise' | 'week' | 'faq'
        | 'events' | 'clubs' | 'members' | 'neighborhoods'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'stats',         label: 'Stats',          icon: '📊' },
  { key: 'home',          label: 'Home',           icon: '🏠' },
  { key: 'about',         label: 'About',          icon: '💬' },
  { key: 'why',           label: 'Why Smileys',    icon: '✨' },
  { key: 'get_involved',  label: 'Get Involved',   icon: '🤝' },
  { key: 'advertise',     label: 'Advertise',      icon: '📢' },
  { key: 'week',          label: 'Week Timeline',  icon: '📅' },
  { key: 'faq',           label: 'FAQ',            icon: '❓' },
  { key: 'events',        label: 'Events Page',    icon: '🎉' },
  { key: 'clubs',         label: 'Clubs Page',     icon: '⬡'  },
  { key: 'members',       label: 'Members Page',   icon: '👥' },
  { key: 'neighborhoods', label: 'Neighborhoods', icon: '📍' },
]

const inputCls  = 'w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500'
const labelCls  = 'block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5'

// Defaults merged into whatever the server returns. Prod's
// content.json was missing `events`, `clubs`, `members`, and
// `neighborhoods` — clicking those tabs would crash the renderer
// because the page assumed `content.<section>.badge` etc. always
// exist. Seeding empty values lets admin fill them in and Save,
// which the route writes back to disk as a brand-new section.
//
// Keep this in sync with the Content interface above. Missing
// top-level fields throw at render time; missing nested fields
// throw on first edit.
const DEFAULT_CONTENT: Content = {
  stats:         [],
  home:          { headline: '', subtitle: '' },
  about:         { headline: '', subtitle: '', story_p1: '', story_p2: '', story_p3: '' },
  why:           { headline: '', tagline: '',  subtitle: '', closing: '' },
  get_involved:  { headline: '', subtitle: '' },
  advertise:     { headline: '', subtitle: '' },
  week:          [],
  faq:           [],
  events:        { headline: '', subtitle: '', badge: '' },
  clubs:         { headline: '', subtitle: '', badge: '' },
  members:       { headline: '', subtitle: '', badge: '' },
  neighborhoods: { headline: '', subtitle: '', badge: '' },
}

interface LiveStats { members: number; events: number; clubs: number }

export default function ContentPage() {
  const [content,   setContent]   = useState<Content | null>(null)
  // What the database actually says, for comparison against the editorial
  // figures below. Never saved back — it's a reference reading, not content.
  const [live,      setLive]      = useState<LiveStats | null>(null)
  const [tab,       setTab]       = useState<Tab>('stats')
  const [saving,    setSaving]    = useState(false)
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Inline-confirm for FAQ-item delete — previously a single click on
  // the × silently dropped the question from local state. Misclick
  // recovery required reloading without saving. Now flips into a red
  // "Delete?" pill that needs a second click to actually remove.
  const [confirmFaqDelete, setConfirmFaqDelete] = useState<string | null>(null)

  useEffect(() => {
    fetch('/app/api/admin/content', { credentials: 'include' })
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          const msg = d?.error ?? `Couldn't load content (HTTP ${r.status})`
          setLoadError(msg)
          toast.error(msg)
          return null
        }
        return r.json()
      })
      .then(d => {
        // Don't blindly setContent(d) — if `d` came back as
        // { error: '...' } from a failed response that slipped through,
        // the previous code would set content to that object and the
        // truthy `if (!content)` check would pass, then the renderer
        // would crash on content.stats.map(...). Only accept when the
        // shape looks like Content.
        if (d && typeof d === 'object' && !Array.isArray(d) && !('error' in d)) {
          // Merge with DEFAULT_CONTENT so any section missing from the
          // stored file (prod's content.json is missing events / clubs
          // / members / neighborhoods) gets an empty object to render
          // against. Without this, clicking those tabs crashes on
          // `content.members.badge` where content.members is undefined.
          const { live: liveStats, ...stored } = d as Content & { live?: LiveStats }
          if (liveStats) setLive(liveStats)
          setContent({ ...DEFAULT_CONTENT, ...(stored as Content) })
        }
      })
      .catch(() => {
        setLoadError('Network error — could not load content')
        toast.error('Network error — could not load content')
      })
      .finally(() => setLoading(false))
  }, [])

  async function save(section: Tab, data: unknown) {
    setSaving(true)
    try {
      const res = await fetch('/app/api/admin/content', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [section]: data }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Surface the server's actual error — previously
        // `throw new Error()` discarded it.
        toast.error(d?.error ?? 'Failed to save')
        return
      }
      setContent(prev => prev ? { ...prev, [section]: data } : prev)
      toast.success('Saved ✓')
    } catch { toast.error('Network error — please try again') }
    finally { setSaving(false) }
  }

  function set<K extends keyof Content>(section: K, value: Content[K]) {
    setContent(prev => prev ? { ...prev, [section]: value } : prev)
  }

  if (loading) return (
    <div className="p-6 space-y-3">
      {[1,2,3].map(i => <div key={i} className="h-24 bg-zinc-900 rounded-2xl border border-zinc-800 animate-pulse" />)}
    </div>
  )
  if (!content) return (
    <div className="p-6 flex flex-col gap-3 items-start">
      <p className="text-zinc-400 text-sm">Couldn&apos;t load content.</p>
      {loadError && <p className="text-xs text-red-400">{loadError}</p>}
      <button onClick={() => window.location.reload()}
        className="px-4 py-2 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-sm font-semibold transition-colors">
        Retry
      </button>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold text-white">Content Editor</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Edit page text directly — no code changes needed.</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
              tab === t.key ? 'bg-amber-500 text-white' : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700'
            }`}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* ── Stats ── */}
      {tab === 'stats' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-4">
          <p className="text-xs text-zinc-500">These numbers appear on the footer and the About, Why Smileys, Advertise and Get Involved pages. They override what the site would otherwise measure for itself.</p>
          {live && (
            <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-4">
              <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Live, from the database</p>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><span className="text-white font-bold tabular-nums">{live.members.toLocaleString('en-US')}</span> <span className="text-zinc-500">approved members</span></div>
                <div><span className="text-white font-bold tabular-nums">{live.events.toLocaleString('en-US')}</span> <span className="text-zinc-500">events hosted</span></div>
                <div><span className="text-white font-bold tabular-nums">{live.clubs.toLocaleString('en-US')}</span> <span className="text-zinc-500">active clubs</span></div>
              </div>
              <p className="text-[11px] text-zinc-600 mt-3">
                Clear a value to fall back to the measured figure. Keep one deliberately if it counts people the platform doesn't
                — just make sure the label says so, since the city cards on the homepage show platform numbers.
              </p>
            </div>
          )}
          {content.stats.map((s, i) => (
            <div key={i} className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Value</label>
                <input value={s.value} onChange={e => set('stats', content.stats.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                  className={inputCls} placeholder="4,000+" />
              </div>
              <div>
                <label className={labelCls}>Label</label>
                <input value={s.label} onChange={e => set('stats', content.stats.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                  className={inputCls} placeholder="Members" />
              </div>
            </div>
          ))}
          <SaveButton onClick={() => save('stats', content.stats)} saving={saving} />
        </div>
      )}

      {/* ── Home ── */}
      {tab === 'home' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-4">
          <p className="text-xs text-zinc-500">Hero section on the homepage.</p>
          <div>
            <label className={labelCls}>Headline</label>
            <input value={content.home.headline} onChange={e => set('home', { ...content.home, headline: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Subtitle</label>
            <textarea value={content.home.subtitle} onChange={e => set('home', { ...content.home, subtitle: e.target.value })} rows={3} className={`${inputCls} resize-none`} />
          </div>
          <SaveButton onClick={() => save('home', content.home)} saving={saving} />
        </div>
      )}

      {/* ── About ── */}
      {tab === 'about' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-4">
          <p className="text-xs text-zinc-500">About Us page — hero and "Our story" section.</p>
          <div>
            <label className={labelCls}>Headline</label>
            <input value={content.about.headline} onChange={e => set('about', { ...content.about, headline: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Subtitle</label>
            <textarea value={content.about.subtitle} onChange={e => set('about', { ...content.about, subtitle: e.target.value })} rows={2} className={`${inputCls} resize-none`} />
          </div>
          <div>
            <label className={labelCls}>Our Story — Paragraph 1</label>
            <textarea value={content.about.story_p1} onChange={e => set('about', { ...content.about, story_p1: e.target.value })} rows={4} className={`${inputCls} resize-none`} />
          </div>
          <div>
            <label className={labelCls}>Our Story — Paragraph 2</label>
            <textarea value={content.about.story_p2} onChange={e => set('about', { ...content.about, story_p2: e.target.value })} rows={4} className={`${inputCls} resize-none`} />
          </div>
          <div>
            <label className={labelCls}>Our Story — Paragraph 3</label>
            <textarea value={content.about.story_p3} onChange={e => set('about', { ...content.about, story_p3: e.target.value })} rows={3} className={`${inputCls} resize-none`} />
          </div>
          <SaveButton onClick={() => save('about', content.about)} saving={saving} />
        </div>
      )}

      {/* ── Why Smileys ── */}
      {tab === 'why' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-4">
          <p className="text-xs text-zinc-500">Why Smileys page — hero section.</p>
          <div>
            <label className={labelCls}>Headline</label>
            <input value={content.why.headline} onChange={e => set('why', { ...content.why, headline: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Tagline (amber text below headline)</label>
            <input value={content.why.tagline} onChange={e => set('why', { ...content.why, tagline: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Subtitle paragraph</label>
            <textarea value={content.why.subtitle} onChange={e => set('why', { ...content.why, subtitle: e.target.value })} rows={3} className={`${inputCls} resize-none`} />
          </div>
          <div>
            <label className={labelCls}>Closing line</label>
            <input value={content.why.closing} onChange={e => set('why', { ...content.why, closing: e.target.value })} className={inputCls} />
          </div>
          <SaveButton onClick={() => save('why', content.why)} saving={saving} />
        </div>
      )}

      {/* ── Get Involved ── */}
      {tab === 'get_involved' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-4">
          <p className="text-xs text-zinc-500">Get Involved page — hero section.</p>
          <div>
            <label className={labelCls}>Headline</label>
            <textarea value={content.get_involved.headline} onChange={e => set('get_involved', { ...content.get_involved, headline: e.target.value })} rows={2} className={`${inputCls} resize-none`} />
          </div>
          <div>
            <label className={labelCls}>Subtitle</label>
            <textarea value={content.get_involved.subtitle} onChange={e => set('get_involved', { ...content.get_involved, subtitle: e.target.value })} rows={3} className={`${inputCls} resize-none`} />
          </div>
          <SaveButton onClick={() => save('get_involved', content.get_involved)} saving={saving} />
        </div>
      )}

      {/* ── Advertise ── */}
      {tab === 'advertise' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-4">
          <p className="text-xs text-zinc-500">Advertise / Partner page — hero section.</p>
          <div>
            <label className={labelCls}>Headline</label>
            <textarea value={content.advertise.headline} onChange={e => set('advertise', { ...content.advertise, headline: e.target.value })} rows={2} className={`${inputCls} resize-none`} />
          </div>
          <div>
            <label className={labelCls}>Subtitle</label>
            <textarea value={content.advertise.subtitle} onChange={e => set('advertise', { ...content.advertise, subtitle: e.target.value })} rows={3} className={`${inputCls} resize-none`} />
          </div>
          <SaveButton onClick={() => save('advertise', content.advertise)} saving={saving} />
        </div>
      )}

      {/* ── Week Timeline ── */}
      {tab === 'week' && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">Appears in the "A Week Inside Smileys" section on the Why Smileys page.</p>
          {content.week.map((d, i) => (
            <div key={i} className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-3">
              <div className="flex items-center gap-3">
                <input value={d.emoji} onChange={e => set('week', content.week.map((x, j) => j === i ? { ...x, emoji: e.target.value } : x))}
                  className="w-14 px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white text-center focus:outline-none focus:ring-2 focus:ring-amber-500" maxLength={8} />
                <div className="flex-1">
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">{d.day}</p>
                  <input value={d.event} onChange={e => set('week', content.week.map((x, j) => j === i ? { ...x, event: e.target.value } : x))}
                    className={inputCls} placeholder="Event name" maxLength={100} />
                </div>
              </div>
              <textarea value={d.desc} onChange={e => set('week', content.week.map((x, j) => j === i ? { ...x, desc: e.target.value } : x))}
                className={`${inputCls} resize-none`} rows={3} maxLength={500} />
            </div>
          ))}
          <SaveButton onClick={() => save('week', content.week)} saving={saving} />
        </div>
      )}

      {/* ── FAQ ── */}
      {tab === 'faq' && (
        <div className="space-y-5">
          <p className="text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">Edit FAQ questions and answers. To add or remove questions, use the buttons below.</p>
          {content.faq.map((section, si) => (
            <div key={section.id} className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-800 bg-zinc-800/40">
                <span>{section.icon}</span>
                <span className="text-sm font-bold text-white">{section.title}</span>
                <span className="text-xs text-zinc-500 ml-1">({section.items.length} questions)</span>
              </div>
              <div className="divide-y divide-zinc-800">
                {section.items.map((item, ii) => (
                  <div key={ii} className="p-4 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 space-y-2">
                        <input value={item.q}
                          onChange={e => set('faq', content.faq.map((s, sj) => sj === si ? { ...s, items: s.items.map((x, ij) => ij === ii ? { ...x, q: e.target.value } : x) } : s))}
                          className={`${inputCls} font-medium`} placeholder="Question…" />
                        <textarea value={item.a}
                          onChange={e => set('faq', content.faq.map((s, sj) => sj === si ? { ...s, items: s.items.map((x, ij) => ij === ii ? { ...x, a: e.target.value } : x) } : s))}
                          rows={3} className={`${inputCls} resize-none`} placeholder="Answer…" />
                      </div>
                      {/* Two-click confirm — was a single-click instant
                          remove. Misclick would silently drop the
                          question from local state. */}
                      {confirmFaqDelete === `${si}-${ii}` ? (
                        <div className="flex items-start gap-1 mt-1 shrink-0">
                          <button
                            onClick={() => {
                              set('faq', content.faq.map((s, sj) => sj === si ? { ...s, items: s.items.filter((_, ij) => ij !== ii) } : s))
                              setConfirmFaqDelete(null)
                            }}
                            className="px-2 py-1 text-[10px] font-bold bg-red-500 hover:bg-red-600 text-white rounded transition-colors">
                            Delete?
                          </button>
                          <button onClick={() => setConfirmFaqDelete(null)}
                            className="px-2 py-1 text-[10px] font-bold text-zinc-400 hover:text-white bg-zinc-800 rounded transition-colors">
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmFaqDelete(`${si}-${ii}`)}
                          className="mt-1 text-zinc-600 hover:text-red-400 transition-colors text-lg leading-none shrink-0">×</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-4 pb-4">
                <button
                  onClick={() => set('faq', content.faq.map((s, sj) => sj === si ? { ...s, items: [...s.items, { q: '', a: '' }] } : s))}
                  className="w-full py-2 rounded-xl border border-dashed border-zinc-700 text-xs text-zinc-500 hover:text-white hover:border-zinc-500 transition-colors">
                  + Add question
                </button>
              </div>
            </div>
          ))}
          <SaveButton onClick={() => save('faq', content.faq)} saving={saving} />
        </div>
      )}

      {/* ── Events Page ── */}
      {tab === 'events' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-4">
          <p className="text-xs text-zinc-500">Hero section on the public Events page (/events).</p>
          <div>
            <label className={labelCls}>Badge text (small pill above headline)</label>
            <input value={content.events.badge} onChange={e => set('events', { ...content.events, badge: e.target.value })} className={inputCls} placeholder="Istanbul" />
          </div>
          <div>
            <label className={labelCls}>Headline</label>
            <input value={content.events.headline} onChange={e => set('events', { ...content.events, headline: e.target.value })} className={inputCls} placeholder="Events" />
          </div>
          <div>
            <label className={labelCls}>Subtitle</label>
            <textarea value={content.events.subtitle} onChange={e => set('events', { ...content.events, subtitle: e.target.value })} rows={2} className={`${inputCls} resize-none`} placeholder="Find your next experience in Istanbul." />
          </div>
          <SaveButton onClick={() => save('events', content.events)} saving={saving} />
        </div>
      )}

      {/* ── Clubs Page ── */}
      {tab === 'clubs' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-4">
          <p className="text-xs text-zinc-500">Hero section on the public Clubs page (/clubs).</p>
          <div>
            <label className={labelCls}>Badge text</label>
            <input value={content.clubs.badge} onChange={e => set('clubs', { ...content.clubs, badge: e.target.value })} className={inputCls} placeholder="Community" />
          </div>
          <div>
            <label className={labelCls}>Headline</label>
            <input value={content.clubs.headline} onChange={e => set('clubs', { ...content.clubs, headline: e.target.value })} className={inputCls} placeholder="Clubs" />
          </div>
          <div>
            <label className={labelCls}>Subtitle</label>
            <textarea value={content.clubs.subtitle} onChange={e => set('clubs', { ...content.clubs, subtitle: e.target.value })} rows={2} className={`${inputCls} resize-none`} placeholder="Discover communities and manage your memberships." />
          </div>
          <SaveButton onClick={() => save('clubs', content.clubs)} saving={saving} />
        </div>
      )}

      {/* ── Members Page ── */}
      {tab === 'members' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-4">
          <p className="text-xs text-zinc-500">Hero section on the Members page (/members). Only visible to logged-in members.</p>
          <div>
            <label className={labelCls}>Badge text</label>
            <input value={content.members.badge} onChange={e => set('members', { ...content.members, badge: e.target.value })} className={inputCls} placeholder="People" />
          </div>
          <div>
            <label className={labelCls}>Headline</label>
            <input value={content.members.headline} onChange={e => set('members', { ...content.members, headline: e.target.value })} className={inputCls} placeholder="Members" />
          </div>
          <div>
            <label className={labelCls}>Subtitle</label>
            <textarea value={content.members.subtitle} onChange={e => set('members', { ...content.members, subtitle: e.target.value })} rows={2} className={`${inputCls} resize-none`} placeholder="Connect with the Smileys community." />
          </div>
          <SaveButton onClick={() => save('members', content.members)} saving={saving} />
        </div>
      )}

      {/* ── Neighborhoods Page ── */}
      {tab === 'neighborhoods' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-4">
          <p className="text-xs text-zinc-500">Hero section on the Neighborhoods page (/neighborhoods).</p>
          <div>
            <label className={labelCls}>Badge text</label>
            <input value={content.neighborhoods.badge} onChange={e => set('neighborhoods', { ...content.neighborhoods, badge: e.target.value })} className={inputCls} placeholder="📍 Explore by neighborhood" />
          </div>
          <div>
            <label className={labelCls}>Headline</label>
            <input value={content.neighborhoods.headline} onChange={e => set('neighborhoods', { ...content.neighborhoods, headline: e.target.value })} className={inputCls} placeholder="Find events near you" />
          </div>
          <div>
            <label className={labelCls}>Subtitle</label>
            <textarea value={content.neighborhoods.subtitle} onChange={e => set('neighborhoods', { ...content.neighborhoods, subtitle: e.target.value })} rows={2} className={`${inputCls} resize-none`} placeholder="Smileys events happen all across Istanbul. Pick a neighborhood and see what's coming up." />
          </div>
          <SaveButton onClick={() => save('neighborhoods', content.neighborhoods)} saving={saving} />
        </div>
      )}
    </div>
  )
}

function SaveButton({ onClick, saving }: { onClick: () => void; saving: boolean }) {
  return (
    <div className="flex justify-end pt-2 border-t border-zinc-800">
      <button onClick={onClick} disabled={saving}
        className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm disabled:opacity-40 transition-colors">
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}
