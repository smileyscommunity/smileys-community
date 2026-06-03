'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

interface Resource {
  title: string
  description: string
  href: string
  badge: string
  badgeColor: string
  tip: string
}
interface Category {
  icon: string
  label: string
  color: string
  resources: Resource[]
}
interface Guide { categories: Category[] }

const COLOR_OPTIONS = [
  { value: 'blue',   label: 'Blue'   },
  { value: 'green',  label: 'Green'  },
  { value: 'amber',  label: 'Amber'  },
  { value: 'rose',   label: 'Rose'   },
  { value: 'violet', label: 'Violet' },
  { value: 'teal',   label: 'Teal'   },
  { value: 'orange', label: 'Orange' },
]

const BADGE_COLORS = [
  { value: '',       label: 'Amber (default)' },
  { value: 'blue',   label: 'Blue'            },
  { value: 'green',  label: 'Green'           },
  { value: 'violet', label: 'Violet'          },
  { value: 'rose',   label: 'Rose'            },
]

const emptyResource = (): Resource => ({ title: '', description: '', href: '', badge: '', badgeColor: '', tip: '' })
const emptyCategory = (): Category => ({ icon: '📌', label: '', color: 'blue', resources: [emptyResource()] })

const inputCls    = 'w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500'
const labelCls    = 'block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1'
const textareaCls = `${inputCls} resize-none`

export default function AdminGuidePage() {
  const [guide,   setGuide]   = useState<Guide>({ categories: [] })
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [openCat, setOpenCat] = useState<number | null>(0)
  const [openRes, setOpenRes] = useState<string | null>(null)
  // Inline-confirm for category removal — was an instant single-click
  // wipe of the whole category and every resource inside.
  const [confirmRemoveCat, setConfirmRemoveCat] = useState<number | null>(null)
  // Snapshot of the last loaded/saved state used to compute the dirty
  // flag. Without this Save was always enabled.
  const [baseline, setBaseline] = useState<string>('')
  const dirty = JSON.stringify(guide) !== baseline

  useEffect(() => {
    fetch('/app/api/admin/guide', { credentials: 'include' })
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          toast.error(d?.error ?? `Couldn't load city guide (HTTP ${r.status})`)
          return null
        }
        return r.json()
      })
      .then(d => {
        if (!d) return
        // Normalize into the Guide shape so a corrupt file or weird
        // legacy payload doesn't crash the renderer (e.g. categories
        // being undefined).
        const next: Guide = { categories: Array.isArray(d.categories) ? d.categories : [] }
        setGuide(next)
        setBaseline(JSON.stringify(next))
      })
      .catch(() => toast.error('Network error — could not load city guide'))
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    if (!dirty) return
    setSaving(true)
    try {
      const res = await fetch('/app/api/admin/guide', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(guide),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Surface the server's actual error — previously
        // `throw new Error()` swallowed it.
        toast.error(data?.error ?? 'Failed to save')
        return
      }
      // Refresh the dirty baseline so the Save button disables.
      setBaseline(JSON.stringify(guide))
      toast.success('City guide saved ✓')
    } catch { toast.error('Network error — please try again') }
    finally { setSaving(false) }
  }

  // Warn before leaving the page if there are unsaved edits.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function updateCat(ci: number, field: keyof Category, val: string) {
    setGuide(g => {
      const cats = [...g.categories]
      cats[ci] = { ...cats[ci], [field]: val }
      return { ...g, categories: cats }
    })
  }

  function moveCatUp(ci: number) {
    if (ci === 0) return
    setGuide(g => {
      const cats = [...g.categories];
      [cats[ci - 1], cats[ci]] = [cats[ci], cats[ci - 1]]
      return { ...g, categories: cats }
    })
    setOpenCat(ci - 1)
  }

  function moveCatDown(ci: number) {
    setGuide(g => {
      if (ci >= g.categories.length - 1) return g
      const cats = [...g.categories];
      [cats[ci], cats[ci + 1]] = [cats[ci + 1], cats[ci]]
      return { ...g, categories: cats }
    })
    setOpenCat(ci + 1)
  }

  function removeCat(ci: number) {
    setGuide(g => ({ ...g, categories: g.categories.filter((_, i) => i !== ci) }))
    setOpenCat(null)
  }

  function addCat() {
    setGuide(g => ({ ...g, categories: [...g.categories, emptyCategory()] }))
    setOpenCat(guide.categories.length)
    setOpenRes(null)
  }

  function updateRes(ci: number, ri: number, field: keyof Resource, val: string) {
    setGuide(g => {
      const cats = [...g.categories]
      const resources = [...cats[ci].resources]
      resources[ri] = { ...resources[ri], [field]: val }
      cats[ci] = { ...cats[ci], resources }
      return { ...g, categories: cats }
    })
  }

  function addRes(ci: number) {
    setGuide(g => {
      const cats = [...g.categories]
      cats[ci] = { ...cats[ci], resources: [...cats[ci].resources, emptyResource()] }
      return { ...g, categories: cats }
    })
    setOpenRes(`${ci}-${guide.categories[ci].resources.length}`)
  }

  function removeRes(ci: number, ri: number) {
    setGuide(g => {
      const cats = [...g.categories]
      cats[ci] = { ...cats[ci], resources: cats[ci].resources.filter((_, i) => i !== ri) }
      return { ...g, categories: cats }
    })
    setOpenRes(null)
  }

  function moveResUp(ci: number, ri: number) {
    if (ri === 0) return
    setGuide(g => {
      const cats = [...g.categories]
      const res = [...cats[ci].resources];
      [res[ri - 1], res[ri]] = [res[ri], res[ri - 1]]
      cats[ci] = { ...cats[ci], resources: res }
      return { ...g, categories: cats }
    })
    setOpenRes(`${ci}-${ri - 1}`)
  }

  function moveResDown(ci: number, ri: number) {
    setGuide(g => {
      const cats = [...g.categories]
      const res = [...cats[ci].resources]
      if (ri >= res.length - 1) return g;
      [res[ri], res[ri + 1]] = [res[ri + 1], res[ri]]
      cats[ci] = { ...cats[ci], resources: res }
      return { ...g, categories: cats }
    })
    setOpenRes(`${ci}-${ri + 1}`)
  }

  if (loading) return (
    <div className="p-8 text-zinc-400 text-sm">Loading…</div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-white">Istanbul City Guide</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Edit categories and resources shown on the member guide page</p>
        </div>
        <button onClick={save} disabled={saving || !dirty}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-bold rounded-xl disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>

      {/* Categories */}
      <div className="space-y-3">
        {guide.categories.map((cat, ci) => (
          <div key={ci} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            {/* Category header */}
            <div className="flex items-center gap-3 px-4 py-3">
              <button onClick={() => setOpenCat(openCat === ci ? null : ci)}
                className="flex-1 flex items-center gap-3 text-left">
                <span className="text-xl">{cat.icon || '📌'}</span>
                <span className="font-semibold text-white text-sm">{cat.label || 'Unnamed category'}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ml-1
                  ${cat.color === 'blue' ? 'bg-blue-900/50 text-blue-400' :
                    cat.color === 'green' ? 'bg-green-900/50 text-green-400' :
                    cat.color === 'amber' ? 'bg-amber-900/50 text-amber-400' :
                    cat.color === 'rose' ? 'bg-rose-900/50 text-rose-400' :
                    cat.color === 'violet' ? 'bg-violet-900/50 text-violet-400' :
                    cat.color === 'teal' ? 'bg-teal-900/50 text-teal-400' :
                    'bg-orange-900/50 text-orange-400'}`}>
                  {cat.resources.length} items
                </span>
                <svg className={`w-4 h-4 text-zinc-500 ml-auto transition-transform ${openCat === ci ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => moveCatUp(ci)} disabled={ci === 0}
                  className="p-1 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-700 disabled:opacity-30 transition-colors" title="Move up">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <button onClick={() => moveCatDown(ci)} disabled={ci === guide.categories.length - 1}
                  className="p-1 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-700 disabled:opacity-30 transition-colors" title="Move down">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {/* Two-click confirm — first click flips the X into
                    a red "Delete?" pill; second click within the same
                    state actually removes. Was an instant nuke of the
                    entire category and every resource in it. */}
                {confirmRemoveCat === ci ? (
                  <div className="flex items-center gap-1 ml-1">
                    <button onClick={() => { removeCat(ci); setConfirmRemoveCat(null) }}
                      className="px-2 py-1 text-[10px] font-bold bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors">
                      Delete?
                    </button>
                    <button onClick={() => setConfirmRemoveCat(null)}
                      className="px-2 py-1 text-[10px] font-bold text-zinc-400 hover:text-white bg-zinc-800 rounded-md transition-colors">
                      ✕
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmRemoveCat(ci)}
                    className="p-1 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-700 transition-colors ml-1" title="Remove category">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Category editor */}
            {openCat === ci && (
              <div className="border-t border-zinc-800 p-4 space-y-4">
                {/* Category meta */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>Icon (emoji)</label>
                    <input value={cat.icon} onChange={e => updateCat(ci, 'icon', e.target.value)}
                      placeholder="🚇" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Label</label>
                    <input value={cat.label} onChange={e => updateCat(ci, 'label', e.target.value)}
                      placeholder="Getting Around" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Color</label>
                    <select value={cat.color} onChange={e => updateCat(ci, 'color', e.target.value)} className={inputCls}>
                      {COLOR_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* Resources */}
                <div>
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-wide mb-2">Resources</p>
                  <div className="space-y-2">
                    {cat.resources.map((r, ri) => {
                      const key = `${ci}-${ri}`
                      const isOpen = openRes === key
                      return (
                        <div key={ri} className="bg-zinc-800 rounded-xl border border-zinc-700 overflow-hidden">
                          <div className="flex items-center gap-2 px-3 py-2">
                            <button onClick={() => setOpenRes(isOpen ? null : key)}
                              className="flex-1 text-left text-sm text-zinc-200 truncate">
                              {r.title || <span className="text-zinc-500 italic">Untitled resource</span>}
                            </button>
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => moveResUp(ci, ri)} disabled={ri === 0}
                                className="p-0.5 text-zinc-600 hover:text-white disabled:opacity-20 transition-colors">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                </svg>
                              </button>
                              <button onClick={() => moveResDown(ci, ri)} disabled={ri === cat.resources.length - 1}
                                className="p-0.5 text-zinc-600 hover:text-white disabled:opacity-20 transition-colors">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                              <button onClick={() => removeRes(ci, ri)}
                                className="p-0.5 text-zinc-600 hover:text-red-400 transition-colors ml-0.5">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                              <svg className={`w-3.5 h-3.5 text-zinc-600 ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </div>
                          {isOpen && (
                            <div className="border-t border-zinc-700 p-3 space-y-3">
                              <div>
                                <label className={labelCls}>Title</label>
                                <input value={r.title} onChange={e => updateRes(ci, ri, 'title', e.target.value)}
                                  placeholder="Resource title" className={inputCls} />
                              </div>
                              <div>
                                <label className={labelCls}>Description</label>
                                <textarea value={r.description} onChange={e => updateRes(ci, ri, 'description', e.target.value)}
                                  rows={3} placeholder="What is this about?" className={textareaCls} />
                              </div>
                              <div>
                                <label className={labelCls}>Link URL (optional)</label>
                                <input value={r.href} onChange={e => updateRes(ci, ri, 'href', e.target.value)}
                                  placeholder="https://... or /neighborhoods/kadikoy" className={inputCls} />
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className={labelCls}>Badge text (optional)</label>
                                  <input value={r.badge} onChange={e => updateRes(ci, ri, 'badge', e.target.value)}
                                    placeholder="Admin Pick" className={inputCls} />
                                </div>
                                <div>
                                  <label className={labelCls}>Badge color</label>
                                  <select value={r.badgeColor} onChange={e => updateRes(ci, ri, 'badgeColor', e.target.value)} className={inputCls}>
                                    {BADGE_COLORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                  </select>
                                </div>
                              </div>
                              <div>
                                <label className={labelCls}>Tip (shown in amber box, optional)</label>
                                <textarea value={r.tip} onChange={e => updateRes(ci, ri, 'tip', e.target.value)}
                                  rows={2} placeholder="💡 Insider tip for members…" className={textareaCls} />
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <button onClick={() => addRes(ci)}
                    className="mt-2 w-full py-2 text-xs font-semibold text-zinc-400 hover:text-amber-400 border border-dashed border-zinc-700 hover:border-amber-500/50 rounded-xl transition-colors">
                    + Add resource
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        <button onClick={addCat}
          className="w-full py-3 text-sm font-semibold text-zinc-400 hover:text-amber-400 border-2 border-dashed border-zinc-700 hover:border-amber-500/50 rounded-2xl transition-colors">
          + Add category
        </button>
      </div>

      <p className="text-xs text-zinc-600 text-center mt-6">
        {/* Previously claimed "Changes are saved to the server
            immediately" — they aren't. Save button is what writes to
            disk. Correcting the lie. */}
        Click <span className="text-amber-400 font-semibold">Save</span> above to publish your changes. The Neighborhoods section is auto-populated from live event data and not editable here.
      </p>
    </div>
  )
}
