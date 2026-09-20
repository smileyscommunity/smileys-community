import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fold } from '../lib/turkishFold'
import {
  ROLE_FILTERS, SORT_PARAM, buildMemberQuery, filtersActive, mergeById, seesProfileOf,
  foldedIncludes, type MemberQuery,
} from '../app/(member)/members/memberList'

// The members directory review (2026-09-20). The modal told members a
// public profile was private while the card behind it showed that same
// profile; counts and "Load more" ignored the filter that was on; sort
// only ever ordered the hundred rows already loaded; every failure read
// as "No members found". These pin the fixes.

const page      = readFileSync(join(__dirname, '..', 'app/(member)/members/page.tsx'), 'utf8')
const discovery = readFileSync(join(__dirname, '..', 'app/(member)/members/MemberDiscovery.tsx'), 'utf8')

const QUERY: MemberQuery = {
  roleFilter: 'All', openTo: '', aroundNow: false, speaksMyLang: false,
  lookingFor: '', search: '', sort: 'newest',
}

describe('search folding', () => {
  it('folds the Turkish dotted/dotless i both ways', () => {
    // 'İpek'.toLowerCase() is "i" + U+0307, which no plain lowercase
    // comparison ever matched.
    expect(fold('İpek')).toBe('ipek')
    expect(fold('IPEK')).toBe('ipek')
    expect(fold('ırmak')).toBe('irmak')
    expect(foldedIncludes('İpek Yılmaz', fold('ipek'))).toBe(true)
    expect(foldedIncludes('Irmak', fold('ırmak'))).toBe(true)
  })

  it('trims, so a trailing space off a phone keyboard still matches', () => {
    expect(fold('  ipek ')).toBe('ipek')
    expect(foldedIncludes('İpek', fold('ipek '))).toBe(true)
  })

  it('matches accented letters by their bare form', () => {
    expect(foldedIncludes('Şişli', fold('sisli'))).toBe(true)
    expect(foldedIncludes('Göztepe', fold('goztepe'))).toBe(true)
  })

  it('does not match on nothing', () => {
    expect(foldedIncludes(null, fold('ipek'))).toBe(false)
    expect(foldedIncludes('İpek', fold('erdem'))).toBe(false)
  })
})

describe('the query sent to /api/members', () => {
  it('always carries sort and offset, in the API\'s vocabulary', () => {
    expect(SORT_PARAM).toEqual({ newest: 'joined', active: 'active', az: 'name' })
    expect(buildMemberQuery({ ...QUERY, sort: 'az' }, 0).get('sort')).toBe('name')
    expect(buildMemberQuery({ ...QUERY, sort: 'active' }, 0).get('sort')).toBe('active')
    expect(buildMemberQuery(QUERY, 0).get('offset')).toBe('0')
  })

  it('pages a FILTERED query too — this is what made "Load more" fetch rows that never rendered', () => {
    const filtered = buildMemberQuery({ ...QUERY, roleFilter: 'Hosts', search: 'ipek' }, 100)
    expect(filtered.get('offset')).toBe('100')
    expect(filtered.get('isHost')).toBe('true')
    expect(filtered.get('search')).toBe('ipek')
  })

  it('trims the search term', () => {
    expect(buildMemberQuery({ ...QUERY, search: '  ipek  ' }, 0).get('search')).toBe('ipek')
    expect(buildMemberQuery({ ...QUERY, search: '   ' }, 0).has('search')).toBe(false)
  })

  it('maps each role pill to its own parameter', () => {
    expect(buildMemberQuery({ ...QUERY, roleFilter: 'Admins' }, 0).get('adminOnly')).toBe('true')
    expect(buildMemberQuery({ ...QUERY, roleFilter: 'Saved' }, 0).get('savedOnly')).toBe('true')
    expect(buildMemberQuery({ ...QUERY, roleFilter: 'All' }, 0).has('isHost')).toBe(false)
  })
})

describe('one answer to "is a filter on"', () => {
  it('counts every filter, not just search and the role pill', () => {
    expect(filtersActive(QUERY)).toBe(false)
    expect(filtersActive({ ...QUERY, search: '   ' })).toBe(false)
    expect(filtersActive({ ...QUERY, search: 'ipek' })).toBe(true)
    expect(filtersActive({ ...QUERY, roleFilter: 'Hosts' })).toBe(true)
    expect(filtersActive({ ...QUERY, openTo: 'coffee' })).toBe(true)
    expect(filtersActive({ ...QUERY, aroundNow: true })).toBe(true)
    expect(filtersActive({ ...QUERY, speaksMyLang: true })).toBe(true)
    expect(filtersActive({ ...QUERY, lookingFor: 'friends' })).toBe(true)
  })

  it('sorting is not filtering — it must not hide contextual discovery', () => {
    expect(filtersActive({ ...QUERY, sort: 'az' })).toBe(false)
  })
})

describe('paging merges', () => {
  it('drops a row the previous page already had — someone joining mid-session shifts every offset', () => {
    const page1 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const page2 = [{ id: 'c' }, { id: 'd' }]
    expect(mergeById(page1, page2).map(m => m.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps the order the server sent', () => {
    expect(mergeById([{ id: 'a' }], [{ id: 'b' }, { id: 'c' }]).map(m => m.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('who sees a profile', () => {
  it('a public member is public to every member', () => {
    expect(seesProfileOf({ restricted: false }, false)).toBe(true)
    expect(seesProfileOf({}, false)).toBe(true)
  })

  it('a connections-only member is locked until connected', () => {
    expect(seesProfileOf({ restricted: true }, false)).toBe(false)
    expect(seesProfileOf({ restricted: true }, true)).toBe(true)
  })
})

describe('the page uses the shared rules', () => {
  it('the modal, the grid card and the deck all gate on seesProfile', () => {
    // Three call sites (modal, card, deck) and no gate left on isConnected
    // for the profile body.
    expect(page.match(/seesProfileOf\(/g)?.length).toBeGreaterThanOrEqual(3)
    expect(page).toContain('{!seesProfile && (')
    expect(page).toContain('{seesProfile && (')
    // The lock copy says what a connection actually adds.
    expect(page).not.toContain('Bio, interests, clubs, and social links are only visible to connected members.')
    expect(page).toContain('Instagram, LinkedIn and work details unlock once you connect.')
  })

  it('the query, the paging and the deck read one state machine', () => {
    expect(page).toContain("import {")
    expect(page).toContain("} from './memberList'")
    expect(page).toContain('const filtersActive = queryNarrowed(query)')
    expect(page).toContain('buildMemberQuery(query, offset)')
    expect(page).toContain('setMembers(prev => mergeById(prev, data.members))')
    // No second list to disagree with the first.
    expect(page).not.toContain('setFilteredMembers')
    expect(page).not.toContain('filteredMembers ??')
    // The footer and the button follow the query on screen.
    expect(page).toContain('{hasMore && (')
    expect(page).not.toContain("hasMore && !search && roleFilter === 'All'")
  })

  it('the deck stops asking for pages when the filtered list is exhausted', () => {
    expect(page).toContain('if (hasMore && !loadingMore && !listLoading) loadMore()')
    expect(page).toContain('resetKey={queryKey}')
    expect(page).toContain('useEffect(() => { setIndex(0) }, [resetKey])')
  })

  it('a failed list is not an empty directory, and 429 says so', () => {
    expect(page).toContain("setListError(res.status === 429 ? 'rate-limit' : 'failed')")
    expect(page).toContain('You’re browsing faster than we can keep up. Give it a minute and try again.')
    expect(page).toContain("action={{ label: 'Retry', onClick: () => setReloadToken(t => t + 1) }}")
  })

  it('the empty state names the filters and clears all of them', () => {
    expect(page).toContain('Nothing matches ${activeFilterLabels.join(\' + \')}')
    expect(page).toContain('onClick: clearAllFilters')
    for (const setter of ["setSearch('')", "setRoleFilter('All')", "setOpenToFilter('')", 'setAroundNow(false)', 'setSpeaksMyLang(false)', "setLookingForFilter('')"]) {
      expect(page.slice(page.indexOf('const clearAllFilters'), page.indexOf('const clearAllFilters') + 600)).toContain(setter)
    }
  })

  it('blocking drops the member from every list on the page', () => {
    expect(page).toContain('setMembers(prev => prev.filter(m => m.id !== memberId))')
    expect(page).toContain('setConnections(prev => prev.filter(c => c.requesterId !== memberId && c.receiverId !== memberId))')
    expect(page).toContain('setHangouts(prev => prev.filter(h => h.user.id !== memberId))')
    expect(page).toContain('onBlocked(m.id)')
  })

  it('an accepted connection refetches that member instead of drawing a full profile over nulls', () => {
    expect(page).toContain("if (updated.status === 'accepted')")
    // By id: a name search would find whoever else shares the name.
    expect(page).toContain('refreshMember(otherId)')
    expect(page).toContain('setSelected(prev => (prev && prev.id === memberId ? fresh : prev))')
  })

  it('a request that is already gone (404) leaves no stuck Pending…', () => {
    expect(page.match(/res\.status === 404/g)?.length).toBeGreaterThanOrEqual(3)
    expect(page).not.toMatch(/if \(!res\.ok\) \{\s*toast\.error\('Could not accept request'\)/)
  })

  it('the card sits above the bottom nav and holds the page still', () => {
    expect(page).toContain('fixed inset-0 z-[60] flex items-end')
    expect(page).toContain("document.body.style.overflow = 'hidden'")
    expect(page).toContain('document.body.style.overflow = previousOverflow')
  })

  it('saving and the full profile are reachable from the modal', () => {
    expect(page).toContain("fetch('/app/api/members/saved', {")
    expect(page).toContain("method: 'POST', credentials: 'include',")
    expect(page).toContain('onToggleSave(m.id)')
    expect(page).toContain('View full profile →')
    // Optimistic, with the rollback on failure.
    expect(page).toContain('flip(wasSaved)')
  })

  it('nothing claims a shared-events count the API never sends, and no dead props', () => {
    expect(page).not.toContain('m.eventIds')
    expect(page).not.toContain('myEventIds')
    expect(page).not.toContain('commonEvents')
    expect(page).not.toContain('members={members}')
  })

  it('"happening now" means started', () => {
    expect(page).toContain('hangouts.filter(h => new Date(h.startsAt).getTime() <= now && new Date(h.endsAt).getTime() >= now)')
    expect(page).toContain("{live ? 'happening now' : 'coming up'}")
  })

  it('a locked card never prints a joined date or a role it was not sent', () => {
    expect(page).toContain('function joinedLabel(')
    expect(page).not.toContain("new Date(m.joinedAt).toLocaleDateString")
  })

  it('the filter tabs own a panel, take arrow keys, and the count is announced', () => {
    expect(page).toContain('id="members-results" role="tabpanel"')
    expect(page).toContain('aria-controls="members-results"')
    expect(page).toContain("e.key === 'ArrowRight'")
    expect(page).toContain('tabIndex={isActive ? 0 : -1}')
    expect(page).toContain('<p className="sr-only" aria-live="polite" aria-atomic="true">')
    // The deck counter is a live region too.
    expect(page).toContain('member {i + 1} of {members.length}')
    expect(ROLE_FILTERS).toEqual(['All', 'Hosts', 'Admins', 'Saved'])
  })
})

describe('discovery rails', () => {
  it('a member who hid their neighbourhood gets no stray pin', () => {
    expect(discovery).toContain('{m.neighborhood && <p className="text-xs text-gray-500 mt-0.5 truncate"><span aria-hidden="true">📍</span> {m.neighborhood}</p>}')
  })
})
