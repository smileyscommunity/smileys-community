'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { confirmToast } from '@/lib/confirmToast'

const BASE_PATH = '/app'

// Turns an absolute same-origin URL into the path router.push expects, or
// null when it isn't one of this app's pages (the landing site lives outside
// basePath and is a full page load, which beforeunload already covers).
export function inAppPath(href: string, origin: string): string | null {
  let url: URL
  try { url = new URL(href, origin) } catch { return null }
  if (url.origin !== origin) return null
  if (url.pathname !== BASE_PATH && !url.pathname.startsWith(BASE_PATH + '/')) return null
  return (url.pathname.slice(BASE_PATH.length) || '/') + url.search + url.hash
}

// Warns before a member walks away from an edited form.
//
// Two exits need covering. A full unload (closing the tab, typing a URL) gets
// the browser's own beforeunload prompt. In-app links are client-side
// navigations that never fire beforeunload, so a click on any link while the
// form is dirty is held and confirmed with a toast — native confirm() is a
// silent no-op in the installed PWA. The listener sits on window in the
// capture phase so it runs before Next's <Link> handler, which is what would
// otherwise navigate.
export function useUnsavedChangesGuard(
  dirty: boolean,
  message = 'You have unsaved changes. Leave without saving?',
) {
  const router   = useRouter()
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    function onClick(e: MouseEvent) {
      // New-tab and modified clicks leave this page open, so nothing is lost.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
      const dest = inAppPath(a.href, window.location.origin)
      if (!dest) return
      const here = window.location.pathname.slice(BASE_PATH.length) + window.location.search
      if (dest.split('#')[0] === here) return
      e.preventDefault()
      e.stopPropagation()
      confirmToast(message, { confirmLabel: 'Leave', cancelLabel: 'Stay' })
        .then(ok => { if (ok) router.push(dest) })
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('click', onClick, true)
    }
  }, [dirty, message, router])

  // For exits that aren't links (a Sign out button): resolves true when it's
  // fine to go, asking first only if something is unsaved.
  const confirmLeave = useCallback(async () => {
    if (!dirtyRef.current) return true
    return confirmToast(message, { confirmLabel: 'Leave', cancelLabel: 'Stay' })
  }, [message])

  return { confirmLeave }
}
