// ── Handbook source watch ────────────────────────────────────────────────────
//
// Every Handbook article cites official pages (Post.officialSources). The 2026-10
// fact-check pass showed how they go stale: Istanbul's fares rose on 20 July,
// İzmir's half-price hours moved, a regulator's page still said "120 days".
// Instead of re-reading every article on a calendar, this sweep re-reads the
// SOURCES each week and flags the articles whose sources actually changed:
//
//   fetch → normalize to visible text → hash → compare with last week
//
// A change stamps HandbookSource.changedAt; sourceChangesForQueue() then lists
// every article citing that URL that hasn't been reviewed since, at the top of
// the /admin/posts review queue. "Reviewed today" on the article clears it.
//
// Noise: government pages carry banners, dates and counters. normaliseHtml
// keeps visible text only (scripts, styles, nav, header, footer and forms are
// dropped), so a moved menu doesn't count — but digits are kept on purpose,
// because a fare or a deadline is exactly the change worth catching.
//
// The first weeks showed what that costs: of 38 flagged changes, ~30 were a
// news sidebar, a clock, a weather widget, a "5 sa önce" stamp or a portal's
// own "last updated" line. Two filters, both aimed at pages that cannot hold
// a fact worth a review: isNoisyUrl() drops news articles, announcements,
// app-store pages and bare homepages from the watch list, and isVolatileLine()
// drops lines that are only a date, a clock time, a relative time, a counter
// or a temperature before the hash is taken.

import { createHash } from 'crypto'
import { prisma } from './prisma'

const FETCH_TIMEOUT_MS = 20_000
const MAX_BYTES        = 5 * 1024 * 1024
const MAX_TEXT         = 200_000
const CONCURRENCY      = 4
const USER_AGENT       = 'SmileysCommunity-SourceWatch/1.0 (+https://smileyscommunity.com; weekly check of pages our Handbook cites)'

// ── Pure helpers ─────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' }

/** Visible text of an HTML page, one block per line. Deterministic for equal content. */
export function normaliseHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/th|\/section|\/article|\/dd|\/dt)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, m => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_TEXT)
}

const MONTH = 'ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık|şub|nis|haz|tem|ağu|eyl|eki|kas|ara|jan\\w*|feb\\w*|mar\\w*|apr\\w*|may|jun\\w*|jul\\w*|aug\\w*|sep\\w*|oct\\w*|nov\\w*|dec\\w*'
const VOLATILE_LINE = [
  /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/,   // 02.10.2026 · 17-09-2026 12:08
  /^\d{1,2}:\d{2}(:\d{2})?$/,                                          // 07:16
  new RegExp(`^\\d{1,2}\\s+(${MONTH})\\.?(\\s+\\d{4})?$`, 'iu'),                  // 05 Ekim 2026 · 26 Sept (month names only: "90 gün" is a rule, not a date)
  /\b\d+\s*(sa|saat|dk|dakika|gün)\s+önce$/iu,                           // 5 sa önce
  /\b\d+\s+(minutes?|hours?|days?|weeks?)\s+ago$/i,                      // 5 days ago
  /^-?\d{1,2}\s?°\s?[CF]?$/,                                             // 18°
  /^Bu sayfa en son\b.*güncellenmiştir\.?$/iu,                           // "this page was last updated on …"
  /\bOkunma sayısı:\s*\d+/iu,                                            // view counters
]
/** A line that is only a timestamp, counter or weather reading — it moves every visit and never means a rule changed. */
export function isVolatileLine(line: string): boolean {
  return VOLATILE_LINE.some(re => re.test(line))
}

/** Normalised text with the volatile lines removed — what the hash and the diff are taken from. */
export function comparableText(text: string): string {
  return text.split('\n').filter(l => !isVolatileLine(l)).join('\n')
}

export function hashOf(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Up to three removed and three added lines, for the reviewer. Null when only line order moved. */
export function diffSummary(before: string, after: string): string | null {
  const a = new Set(before.split('\n')), b = new Set(after.split('\n'))
  const removed = [...a].filter(l => !b.has(l)).slice(0, 3)
  const added   = [...b].filter(l => !a.has(l)).slice(0, 3)
  if (removed.length === 0 && added.length === 0) return null
  const cut = (l: string) => (l.length > 160 ? `${l.slice(0, 157)}…` : l)
  return [...removed.map(l => `− ${cut(l)}`), ...added.map(l => `+ ${cut(l)}`)].join('\n')
}

/**
 * Only public https pages: these URLs are staff-entered, but the sweep runs on
 * the server, so a typo'd or hostile entry must not reach anything internal.
 */
export function isWatchableUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:') return false
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false
  if (/^\d+(\.\d+){3}$/.test(h) || h.includes(':') || h.startsWith('[')) return false   // IP literals
  return h.includes('.')
}

// Pages whose sidebars and tickers change daily while the thing cited does
// not: news sites, app stores. (A published news article is not revised, so
// watching it can only produce noise.)
const NOISY_HOSTS = [
  'apps.apple.com', 'play.google.com', 'bigpara.hurriyet.com.tr', 'hurriyet.com.tr', 'bloomberght.com', 'cnnturk.com',
  'evrensel.net', 'gazetevatan.com', 'teknoblog.com', 'news.gtp.gr', 'birgun.net', 'sabah.com.tr', 'milliyet.com.tr',
  'haberturk.com', 'trthaber.com', 'aa.com.tr', 'dailysabah.com',
]
const NEWS_PATH = /^(haber|haberler|news|duyuru|duyurular)$/i

/** News articles, announcements, app-store pages and bare homepages — never worth a review on their own. */
export function isNoisyUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  const h = u.hostname.toLowerCase()
  if (NOISY_HOSTS.some(n => h === n || h.endsWith(`.${n}`))) return true
  if (u.pathname.split('/').some(seg => NEWS_PATH.test(seg))) return true
  return (u.pathname === '/' || u.pathname === '') && !u.search   // a homepage carries today's headlines
}

/** Every distinct watchable source URL cited by a published Handbook article. */
export function collectSourceUrls(posts: { officialSources: unknown }[]): string[] {
  const urls = new Set<string>()
  for (const p of posts) {
    if (!Array.isArray(p.officialSources)) continue
    for (const s of p.officialSources as { url?: unknown }[]) {
      if (typeof s?.url === 'string' && isWatchableUrl(s.url) && !isNoisyUrl(s.url)) urls.add(s.url)
    }
  }
  return [...urls].sort()
}

export interface SourceChange {
  postId: string; slug: string; title: string
  url: string; label: string; changedAt: Date; diff: string | null
}

/** Articles with a source that changed after the article's last review (or that was never reviewed). */
export function sourceChangesForQueue(
  posts: { id: string; slug: string; title: string; lastReviewedAt: Date | null; officialSources: unknown }[],
  sources: { url: string; changedAt: Date | null; lastDiff: string | null }[],
): SourceChange[] {
  const byUrl = new Map(sources.filter(s => s.changedAt).map(s => [s.url, s]))
  const out: SourceChange[] = []
  for (const p of posts) {
    if (!Array.isArray(p.officialSources)) continue
    for (const s of p.officialSources as { url?: unknown; label?: unknown }[]) {
      if (typeof s?.url !== 'string' || isNoisyUrl(s.url)) continue
      const src = byUrl.get(s.url)
      if (!src?.changedAt) continue
      if (p.lastReviewedAt && p.lastReviewedAt >= src.changedAt) continue
      out.push({ postId: p.id, slug: p.slug, title: p.title, url: s.url, label: typeof s.label === 'string' ? s.label : s.url, changedAt: src.changedAt, diff: src.lastDiff })
    }
  }
  return out.sort((x, y) => y.changedAt.getTime() - x.changedAt.getTime())
}

// ── The sweep ────────────────────────────────────────────────────────────────

type Fetched = { ok: true; status: number; hash: string; text: string | null } | { ok: false; status: number | null; error: string }

async function fetchSource(url: string): Promise<Fetched> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/pdf;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: ctrl.signal })
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` }
    // A redirect off https (or to an internal host) is refused like the URL itself.
    if (res.url && !isWatchableUrl(res.url)) return { ok: false, status: res.status, error: 'Redirected to a non-public URL' }
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) return { ok: false, status: res.status, error: 'Page too large' }
    const type = res.headers.get('content-type') ?? ''
    if (type.includes('html') || type.includes('text/plain')) {
      const text = normaliseHtml(new TextDecoder('utf-8', { fatal: false }).decode(buf))
      const kept = comparableText(text)
      return { ok: true, status: res.status, hash: hashOf(kept), text: kept }
    }
    // PDFs and other files: the bytes are the content; no text to diff.
    return { ok: true, status: res.status, hash: hashOf(buf), text: null }
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? (e.name === 'AbortError' ? 'Timed out' : e.message).slice(0, 200) : 'Fetch failed' }
  } finally {
    clearTimeout(timer)
  }
}

export interface SweepResult { checked: number; changed: number; baselined: number; failed: number }

/** Check every cited source once. Four at a time, never two on the same host at once. */
export async function runSourceWatch(now: Date = new Date()): Promise<SweepResult> {
  const posts = await prisma.post.findMany({ where: { kind: 'handbook', status: 'published' }, select: { officialSources: true } })
  const urls  = collectSourceUrls(posts)
  const known = new Map((await prisma.handbookSource.findMany({ where: { url: { in: urls } }, select: { url: true, contentHash: true, text: true } })).map(r => [r.url, r]))

  const result: SweepResult = { checked: 0, changed: 0, baselined: 0, failed: 0 }
  const busyHosts = new Set<string>()
  const queue = [...urls]

  const worker = async () => {
    while (queue.length) {
      const i = queue.findIndex(u => !busyHosts.has(new URL(u).hostname))
      if (i < 0) { await new Promise(r => setTimeout(r, 200)); continue }
      const url  = queue.splice(i, 1)[0]
      const host = new URL(url).hostname
      busyHosts.add(host)
      try {
        const got  = await fetchSource(url)
        const prev = known.get(url)
        result.checked++
        if (!got.ok) {
          result.failed++
          await prisma.handbookSource.upsert({
            where:  { url },
            create: { url, lastStatus: got.status, lastError: got.error, checkedAt: now },
            update: { lastStatus: got.status, lastError: got.error, checkedAt: now },
          })
          continue
        }
        // Same lines in a new order (a re-sorted list, a moved menu) is not a
        // change a reader would notice: the hash moves, the diff is empty.
        // The stored text may predate the volatile-line filter: filter it the
        // same way, or the first sweep after it would flag everything once.
        const prevText = prev?.text ? comparableText(prev.text) : null
        const prevHash = prevText !== null ? hashOf(prevText) : prev?.contentHash
        const diff     = prevText && got.text ? diffSummary(prevText, got.text) : null
        const changed  = !!prev?.contentHash && prevHash !== got.hash && !(prevText && got.text && diff === null)
        if (!prev?.contentHash) result.baselined++
        if (changed) result.changed++
        await prisma.handbookSource.upsert({
          where:  { url },
          create: { url, contentHash: got.hash, text: got.text, lastStatus: got.status, lastError: null, checkedAt: now },
          update: {
            contentHash: got.hash, text: got.text, lastStatus: got.status, lastError: null, checkedAt: now,
            ...(changed ? { changedAt: now, lastDiff: diff } : {}),
          },
        })
      } finally {
        busyHosts.delete(host)
        await new Promise(r => setTimeout(r, 500))   // a breath between requests
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return result
}
