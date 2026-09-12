import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8')

// Scan-4 admin UI findings 1–10: city-day compares, surfaced failures,
// row currencies/neighborhoods, batch actions, zone-correct audit bounds.

describe('user page: no-show is a city-day compare, links open without an opener (1)', () => {
  const src = read('app/admin/users/[id]/page.tsx')
  it('never compares the event day to a UTC instant or UTC date', () => {
    expect(src).not.toContain('new Date(je.event.date) < new Date()')
    expect(src).not.toContain("je.event.date < new Date().toISOString().split('T')[0]")
    expect(src).toContain('return ev.date < todayInTz(ev.city?.timezone ?? DEFAULT_TZ)')
    expect(src).toContain('attendedEvents.filter(je => isPastEventDay(je.event))')
  })
  it('the API selects the joined event city timezone', () => {
    expect(read('app/api/admin/users/[id]/route.ts')).toContain('price: true, city: { select: { timezone: true } } } } },')
  })
  it('every window.open passes noopener,noreferrer', () => {
    const opens = src.match(/window\.open\([^\n]*/g) ?? []
    expect(opens.length).toBe(3)
    for (const o of opens) expect(o).toContain("'_blank', 'noopener,noreferrer')")
  })
})

describe('event edit: co-host and delete check res.ok (2)', () => {
  const src = read('app/admin/events/[id]/edit/page.tsx')
  it('removeCohost only drops the chip after an ok response', () => {
    expect(src).toMatch(/async function removeCohost[\s\S]*?if \(!res\.ok\) \{ await toastApiError\(res, 'Could not remove co-host'\); return \}\s*\n\s*setCohosts\(prev => prev\.filter/)
  })
  it('addCohost toasts a refusal', () => {
    expect(src).toContain("if (!res.ok) { await toastApiError(res, 'Could not add co-host'); return }")
  })
  it('handleDelete toasts a failed DELETE instead of swallowing it', () => {
    expect(src).toMatch(/async function handleDelete[\s\S]*?if \(!res\.ok\) \{ await toastApiError\(res, 'Could not delete event'\); return \}\s*\n\s*router\.push\('\/admin\/events'\)/)
  })
})

describe('newsletter: editing a scheduled send does not delete it up front (3)', () => {
  const src = read('app/admin/newsletter/page.tsx')
  it('editScheduled no longer fetches DELETE', () => {
    const edit = src.slice(src.indexOf('function editScheduled'), src.indexOf('async function retireEditedOriginal'))
    expect(edit).not.toContain('fetch(')
    expect(edit).toContain('setEditingId(n.id)')
  })
  it('the original is retired only after the new POST succeeded', () => {
    expect(src).toMatch(/if \(!res\.ok\) \{ toast\.error\(d\?\.error \?\? 'Send failed'\); return \}\s*\n[\s\S]{0,120}if \(editingId\) \{[\s\S]*?await retireEditedOriginal\(originalId\)/)
  })
})

describe('create buttons cannot stick on a non-JSON error (4)', () => {
  for (const p of ['app/admin/clubs/page.tsx', 'app/admin/campaigns/page.tsx']) {
    it(p, () => {
      const src = read(p)
      expect(src).toMatch(/\} finally \{\s*\n\s*setSaving\(false\)\s*\n\s*\}/)
      expect(src).toContain('await res.json().catch(() => null)')
      expect(src).not.toMatch(/await res\.json\(\)\s*\n\s*setSaving\(false\)/)
    })
  }
})

describe('analytics (5)', () => {
  const src = read('app/admin/analytics/page.tsx')
  it('dormant Draft / Send toast failures', () => {
    expect(src).toContain("toast.error(d?.error ?? 'Could not draft')")
    expect(src).toContain("toast.error(d?.error ?? 'Could not send')")
  })
  it('top events format the text date with formatDay', () => {
    expect(src).not.toContain('new Date(e.date).toLocaleDateString()')
    expect(src).toContain("formatDay(e.date, { day: 'numeric', month: 'short', year: 'numeric' })")
  })
  it('revenue is labelled with the scoped cities currency, never blindly the current city', () => {
    expect(src).not.toMatch(/formatMoney\(data\.revenue\.\w+, cur\)/)
    expect(src).not.toContain('formatMoney(c.revenue, cur)')
    expect(src).not.toContain('({currencySymbol(cur).trim()})')
    expect(src).toContain('(cityId ? cities.filter(c => c.id === cityId) : cities)')
    expect(src).toContain("revCur ? ` (${currencySymbol(revCur).trim()})` : ' (mixed currencies)'")
  })
  it('localStorage access is guarded', () => {
    expect(src).toContain("try { return window.localStorage.getItem('admin_analytics_city') || '' } catch { return '' }")
  })
})

describe('money uses the row currency (6)', () => {
  it('payments', () => {
    const src = read('app/admin/payments/page.tsx')
    expect(src).not.toContain('formatMoney(p.amount, cur)')
    expect(src).toContain('formatMoney(p.amount, p.currency)')
    expect(src).toContain('formatMoney(refundConfirm.amount, refundConfirm.currency)')
  })
  it('events', () => {
    const src = read('app/admin/events/page.tsx')
    expect(src).not.toContain('formatMoney(event.price, cur)')
    expect(src.split('formatMoney(event.price, event.currency || cur)').length - 1).toBe(2)
  })
})

describe('neighborhood dropdowns follow the edited row city (7)', () => {
  it('directory rows get their own city list and keep an off-list value', () => {
    const src = read('app/admin/directory/page.tsx')
    expect(src).toContain('neighborhoods={b.city?.slug ? (hoodsByCity[b.city.slug] ?? []) : neighborhoods}')
    expect(src).toContain('/app/api/neighborhoods?city=${encodeURIComponent(slug)}')
    expect(src).toContain('{b.neighborhood && !neighborhoods.includes(b.neighborhood) && (')
  })
  it('hangouts edit uses the hangout city', () => {
    const src = read('app/admin/hangouts/page.tsx')
    expect(src).toContain('const neighborhoods = useCityNeighborhoods(editing?.city?.slug)')
    expect(src).not.toContain('const neighborhoods = useCityNeighborhoods()')
    expect(src).toContain('{editing?.neighborhood && !neighborhoods.includes(editing.neighborhood) && (')
  })
})

describe('participants: confirmed sequential batches, city-day past check (8)', () => {
  const src = read('app/admin/events/[id]/participants/page.tsx')
  it('no forEach fan-out of per-row handlers', () => {
    expect(src).not.toContain('pending.forEach(a => approveAttendee(a.userId))')
    expect(src).not.toContain('.forEach(promote)')
    expect(src).toContain('onClick={() => approveAll(pending)} disabled={busy !== null}')
    expect(src).toContain('onClick={() => promoteBatch(waitlist.slice(0, event.spotsLeft))} disabled={busy !== null}')
  })
  it('batches confirm, run one at a time, summarise once and reload', () => {
    expect(src).toMatch(/async function approveAll[\s\S]*?confirmToast\(/)
    expect(src).toMatch(/async function promoteBatch[\s\S]*?confirmToast\(/)
    expect(src).toMatch(/for \(const userId of userIds\) \{[\s\S]*?await fetch\(/)
    expect(src).toContain('setReloadTick(t => t + 1)')
    expect(src).toContain('}, [id, reloadTick])')
    expect(src).toContain('`${verb} ${ok} · ${failed} failed')
  })
  it('isPastEvent compares against the event city today', () => {
    expect(src).not.toContain('event.date < new Date().toISOString().slice(0, 10)')
    expect(src).toContain('const isPastEvent      = event.date < todayInTz(eventTz)')
  })
})

describe('audit: zone-correct range bounds (9)', () => {
  const src = read('app/admin/audit/page.tsx')
  it('no bare zone-less end-of-day', () => {
    expect(src).not.toContain("qs.set('to',     `${toDate}T23:59:59.999`)")
    expect(src).toContain('fromWallClockInTz(`${day}T00:00`, rangeTz)')
    expect(src).toContain('dayStartIso(shiftDay(toDate, 1))')
    expect(src).toContain("qs.set('from',   fromIso)")
  })
})

describe('misc guards (10)', () => {
  it('feedback CSV export opens without an opener', () => {
    expect(read('app/admin/feedback/page.tsx')).toContain("window.open(`/app/api/admin/surveys?${qs}`, '_blank', 'noopener,noreferrer')")
  })
  it('dashboard localStorage read is guarded', () => {
    expect(read('app/admin/page.tsx')).toContain("try { return window.localStorage.getItem('admin_dash_city') || null } catch { return null }")
  })
})
