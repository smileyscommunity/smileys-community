// Fill directory listings with everything that can be found about the venue.
//
// For each selected business the script researches the venue on the web
// (OpenAI Responses API with web search), then fills what the row is missing:
// description, website, Instagram, phone, address, hours, languages, tags and
// a cover photo taken from the venue's own website (its og:image).
//
// Research is a claim, not a fact, so the script checks before it stores:
//   - the website must be a real site (not a social profile), be https, and
//     actually answer — the one that gave us a dead link once (crumpetlondon
//     1992.com) would fail here
//   - Instagram goes through normalizeInstagramHandle, hours through
//     parseHours, text through DIRECTORY_LIMITS — the admin form's validators
//   - hours are stored only when the researcher says it is confident; a wrong
//     closing time sends a member to a locked door
//   - the cover is the verified website's og:image, ≥600px wide, run through
//     the same sharp pipeline as /api/upload (rotate, ≤1200px, q82, EXIF
//     stripped) into UPLOAD_DIR/directory
//
// Only EMPTY fields are filled. A description counts as empty when it is one
// of the factual placeholders earlier imports wrote ("Community venue — added
// from a Smileys event", "hosting Smileys events since …") or is shorter than
// 60 characters; the "hosting Smileys events since <month>" fact is kept as
// the closing sentence. --overwrite replaces real values too. Nothing is ever
// deleted or hidden: a venue the researcher reports as permanently closed, or
// as not a business at all (a park, a station), is printed for a human and
// left alone.
//
// Dry run by default — prints what it would write, per row, with sources.
// --write applies and leaves an audit-log entry per row (directory.fill,
// actor system:script) naming the fields. Re-running is idempotent: filled
// fields are no longer empty, so they are skipped.
//
// Run on the server (OPENAI_API_KEY is in the server env; both files):
//   cd /root/smileys-community && npx tsx --env-file=.env --env-file=.env.local \
//     scripts/fill-directory-listings.ts                       # dry run, all live listings
//   … --city istanbul --limit 3                                 # trial
//   … --id cmujrd0fe002qmi6fjriw0sta --write                     # one row
//   … --pending --write                                         # the approval queue too
//
// Flags: --write · --overwrite · --pending (include unapproved rows) ·
//        --city <slug> · --id <id> (repeatable) · --limit N · --no-cover ·
//        --model <openai model> (default gpt-5-mini)
//
// Before the release that carries lib/directoryFill.ts is deployed, copy both
// files: scp lib/directoryFill.ts root@…:/root/smileys-community/lib/ and the
// script to …/scripts/.

import OpenAI from 'openai'
import sharp from 'sharp'
import { randomBytes } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { uploadRoot } from '@/lib/uploadRoot'
import { writeAudit, SCRIPT_ACTOR } from '@/lib/audit'
import { DAY_KEYS } from '@/lib/businessHours'
import {
  buildFillPatch, cleanSources, coverDimensionsOk, coverLooksLikePhoto, ogImageFrom, isPlaceholderDescription, siteMentionsPlace, visibleTextLength, websiteLandingOk, MIN_READABLE_TEXT,
  type FillableRow, type FillPatch, type VenueResearch,
} from '@/lib/directoryFill'

// ── Flags ───────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(`--${name}`)
const value = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}
const values = (name: string): string[] => {
  const out: string[] = []
  argv.forEach((a, i) => { if (a === `--${name}` && argv[i + 1] && !argv[i + 1].startsWith('--')) out.push(argv[i + 1]) })
  return out
}

const WRITE     = flag('write')
const OVERWRITE = flag('overwrite')
const PENDING   = flag('pending')
const NO_COVER  = flag('no-cover')
const CITY      = value('city')
const IDS       = values('id')
const LIMIT     = Number(value('limit') ?? 0) || undefined
const MODEL     = value('model') ?? 'gpt-5-mini'

// Gentle on both the API and the venues' sites.
const ROW_DELAY_MS   = 500
const FETCH_TIMEOUT  = 12_000
// Big enough for script-heavy sites whose city is named 1 MB in (Mozaik Studio).
const HTML_MAX_BYTES = 2 * 1024 * 1024
const IMAGE_MAX_BYTES = 15 * 1024 * 1024
const USER_AGENT = 'Mozilla/5.0 (compatible; SmileysDirectory/1.0; +https://smileyscommunity.com)'

// ── Research ────────────────────────────────────────────────────────────────

// Strict structured output: every property required, nullable where unknown.
const HOURS_SCHEMA = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: Object.fromEntries(DAY_KEYS.map(d => [d, {
    type: ['string', 'null'],
    description: `${d}: "HH:MM-HH:MM" (24h, e.g. "09:30-18:00"; cross-midnight allowed "21:00-02:00"), "closed", or null when unknown`,
  }])),
  required: [...DAY_KEYS],
}

const RESEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found:              { type: 'boolean', description: 'true when this exact venue (same name, same neighborhood/address) was identified online' },
    is_business:        { type: 'boolean', description: 'false for parks, piers, stations, public buildings, walking routes' },
    permanently_closed: { type: 'boolean' },
    description:        { type: ['string', 'null'], description: 'The listing text, 180-320 characters, per the writing rules' },
    website:            { type: ['string', 'null'], description: "The venue's own website URL, or null. Not a social profile." },
    instagram:          { type: ['string', 'null'], description: 'Instagram handle or profile URL, or null' },
    phone:              { type: ['string', 'null'], description: 'Phone number as published, with country code if shown' },
    address:            { type: ['string', 'null'], description: 'Street address as published' },
    hours:              HOURS_SCHEMA,
    hours_confident:    { type: 'boolean', description: 'true only when hours come from the venue itself or a current, consistent listing' },
    languages:          { type: ['string', 'null'], description: 'Languages spoken/served, e.g. "English, Turkish", ONLY if a source says so' },
    tags:               { type: 'array', items: { type: 'string' }, description: 'Up to 5 lowercase tags for what the place is or offers, e.g. "specialty coffee", "rooftop", "vegan options". No place names, no opinions.' },
    sources:            { type: 'array', items: { type: 'string' }, description: 'URLs the facts came from' },
    notes:              { type: 'string', description: 'Anything a human editor should know (ambiguity, conflicting hours, rename, relocation)' },
  },
  required: ['found', 'is_business', 'permanently_closed', 'description', 'website', 'instagram', 'phone',
             'address', 'hours', 'hours_confident', 'languages', 'tags', 'sources', 'notes'],
}

const SYSTEM = `You research venues for the directory of Smileys Community, a members-only community that helps expats and newcomers make real-life friends. The directory makes a factual promise — this place exists, here, is open — so you never invent. Search the web for the exact venue (name + neighborhood + city), confirm it is the same place, and report only what sources support. If unsure about a fact, return null for it. If the venue cannot be identified, set found=false.

Never use smileyscommunity.com as a source: that is the directory you are filling, so citing it is circular.

Writing the description: sound like a well-connected friend who has lived in the city a while — warm, specific, practical, never corporate, never hype. Two or three sentences, 180–320 characters, English, plain text, no emoji, no exclamation marks, no ratings or review counts, no "must-visit"/"hidden gem"/"perfect for". Say what the place is and what it is actually good for (a dish, the coffee, the space, who goes there) only when sources support it. Mention the neighborhood once, naturally, inside a sentence — never as a trailing "Located in X." Do not mention Smileys.
These are venues the community uses and likes. Be generous and truthful: state facts plainly, as your own knowledge — never "reviews say", "locals describe", "listings show", "according to". Leave out anything unflattering or incidental: smoke, noise complaints, being a chain, "budget"/"cheap"/"mid-range", service complaints. If the only things you can find are unflattering, keep the description to what the place is and offers.
Every sentence is about the place itself. Never write about the listing, the research or the sources: no "the address on file", "listed on the company site", "the store listing is maintained by", "no website was found".

Website and Instagram: only this venue's own, or its chain's when the chain runs this branch. A same-named business in another city or country is a different venue — never return its site or handle.

Tags: up to 5, lowercase, each a thing a member could filter on — what the place is or offers ("specialty coffee", "rooftop", "live music", "vegan options", "board games"). Never a place name, neighborhood, street, landmark or "near X"; never an opinion ("cozy", "authentic", "casual", "trendy").

Hours: use the venue's own site or Google listing; give "HH:MM-HH:MM" per day, "closed" for closed days, null when unknown; set hours_confident=true only when the source is current and consistent.`

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

async function research(row: RowWithCity): Promise<VenueResearch> {
  const known = [
    `Name: ${row.name}`,
    `Category: ${row.category}`,
    `Neighborhood: ${row.neighborhood ?? 'unknown'}`,
    `City: ${row.city.name}, ${row.city.country}`,
    row.address   ? `Address on file: ${row.address}`     : null,
    row.website   ? `Website on file: ${row.website}`     : null,
    row.instagram ? `Instagram on file: @${row.instagram}` : null,
    !isPlaceholderDescription(row.description) ? `Current description (keep its facts if still true): ${row.description}` : null,
  ].filter(Boolean).join('\n')

  const response = await openai.responses.create({
    model: MODEL,
    ...(MODEL.startsWith('gpt-5') ? { reasoning: { effort: 'low' as const } } : {}),
    tools: [{
      type: 'web_search',
      search_context_size: 'medium',
      user_location: { type: 'approximate', country: row.city.country, city: row.city.name },
    }],
    input: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Research this venue and fill the JSON.\n\n${known}` },
    ],
    text: { format: { type: 'json_schema', name: 'venue_research', strict: true, schema: RESEARCH_SCHEMA } },
  })

  const text = response.output_text?.trim()
  if (!text) throw new Error(`empty research output (status ${response.status})`)
  return JSON.parse(text) as VenueResearch
}

// ── Website + cover ─────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, accept: string): Promise<Response> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT)
  try {
    return await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, redirect: 'follow', signal: ctl.signal })
  } finally { clearTimeout(t) }
}

async function readCapped(res: Response, cap: number): Promise<Buffer> {
  const reader = res.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done || !value) break
    chunks.push(value)
    total += value.length
    if (total >= cap) { await reader.cancel().catch(() => {}); break }
  }
  return Buffer.concat(chunks)
}

/** The site answered (2xx/3xx after redirects); html is the first 512 KB. */
async function checkWebsite(url: string): Promise<{ ok: boolean; html: string; finalUrl: string; why?: string }> {
  try {
    const res = await fetchWithTimeout(url, 'text/html,application/xhtml+xml')
    if (res.status >= 400) return { ok: false, html: '', finalUrl: res.url || url, why: `HTTP ${res.status}` }
    if (res.url && !websiteLandingOk(url, res.url)) {
      await res.body?.cancel().catch(() => {})
      return { ok: false, html: '', finalUrl: res.url, why: `lands on ${res.url} (another site or a login page)` }
    }
    const html = (await readCapped(res, HTML_MAX_BYTES)).toString('utf8')
    return { ok: true, html, finalUrl: res.url || url }
  } catch (e) {
    return { ok: false, html: '', finalUrl: url, why: (e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message }
  }
}

interface CoverCandidate { url: string; width: number; height: number; buffer: Buffer }

async function coverFromSite(html: string, pageUrl: string): Promise<{ cover?: CoverCandidate; why?: string }> {
  const img = ogImageFrom(html, pageUrl)
  if (!img) return { why: 'site has no og:image' }
  try {
    const res = await fetchWithTimeout(img, 'image/*')
    if (res.status >= 400) return { why: `og:image HTTP ${res.status}` }
    if (!/^image\//i.test(res.headers.get('content-type') ?? '')) return { why: 'og:image is not an image' }
    const buffer = await readCapped(res, IMAGE_MAX_BYTES)
    const meta = await sharp(buffer, { limitInputPixels: 50_000_000 }).metadata()
    // EXIF orientation 5-8 means the stored pixels are rotated 90°.
    const swap = (meta.orientation ?? 1) >= 5
    const width = swap ? meta.height : meta.width, height = swap ? meta.width : meta.height
    if (!coverDimensionsOk(width, height)) return { why: `og:image ${width ?? '?'}x${height ?? '?'} too small or odd shape` }
    const { entropy } = await sharp(buffer, { limitInputPixels: 50_000_000 }).stats()
    if (!coverLooksLikePhoto(img, entropy)) return { why: `og:image looks like a logo or graphic, not a photo (entropy ${entropy.toFixed(1)})` }
    return { cover: { url: img, width: width!, height: height!, buffer } }
  } catch (e) {
    return { why: `og:image: ${(e as Error).message}` }
  }
}

/** Same pipeline as app/api/upload/route.ts, same folder, same URL shape. */
async function saveCover(c: CoverCandidate): Promise<string> {
  const dir = join(uploadRoot(), 'directory')
  mkdirSync(dir, { recursive: true })
  const filename = `${Date.now()}-${randomBytes(6).toString('hex')}.jpg`
  const out = await sharp(c.buffer, { limitInputPixels: 50_000_000 })
    .rotate().resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
  writeFileSync(join(dir, filename), out)
  return `/app/api/files/directory/${filename}`
}

// ── Main ────────────────────────────────────────────────────────────────────

type RowWithCity = FillableRow & {
  id: string; category: string; neighborhood: string | null; isApproved: boolean; cityId: string
  city: { name: string; slug: string; country: string }
}

const hoursLine = (h: FillPatch['hours']) => DAY_KEYS.map(d => `${d} ${h?.[d] ?? 'closed'}`).join(', ')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('✗ OPENAI_API_KEY is not set — run with --env-file=.env --env-file=.env.local')
    process.exit(1)
  }

  const rows = await prisma.business.findMany({
    where: IDS.length
      ? { id: { in: IDS } }
      : { isActive: true, ...(PENDING ? {} : { isApproved: true }), ...(CITY ? { city: { slug: CITY } } : {}) },
    orderBy: [{ isApproved: 'desc' }, { name: 'asc' }],
    take: LIMIT,
    select: {
      id: true, name: true, category: true, neighborhood: true, description: true, website: true,
      instagram: true, phone: true, address: true, hours: true, languages: true, tags: true,
      coverImage: true, isApproved: true, cityId: true,
      city: { select: { name: true, slug: true, country: true } },
    },
  })
  if (!rows.length) { console.log('No matching listings.'); return }

  console.log(`${WRITE ? 'FILLING' : 'DRY RUN'} — ${rows.length} listing(s), model ${MODEL}` +
              `${OVERWRITE ? ', overwriting existing values' : ', empty fields only'}${NO_COVER ? ', covers off' : ''}\n`)

  let written = 0, unchanged = 0, failed = 0, flagged = 0

  for (const row of rows) {
    console.log(`── ${row.name} (${row.neighborhood ?? '—'}, ${row.city.name}) · ${row.category} · ${row.isApproved ? 'live' : 'pending'}`)
    try {
      const r = await research(row)
      r.sources = cleanSources(r.sources)
      if (r.sources.length) console.log(`   sources: ${r.sources.slice(0, 4).join('  ')}`)
      if (r.notes) console.log(`   note: ${r.notes}`)

      if (!r.found) { console.log('   ⚠ not identified online — nothing written'); flagged++; continue }
      if (!r.is_business) { console.log('   ⚠ not a business (park / public place) — nothing written; consider removing it from the directory'); flagged++; continue }
      if (r.permanently_closed) { console.log('   ⚠ reported PERMANENTLY CLOSED — nothing written; verify and set closedAt in /admin/directory'); flagged++; continue }

      // Website: verify before the patch is built, so "did not respond" is a
      // reason in the plan rather than a surprise in production.
      let websiteOk: boolean | undefined
      let wrongVenue = false
      let siteHtml = '', siteUrl = ''
      const claimedSite = r.website && !/instagram\.com|facebook\.com/i.test(r.website) ? r.website : null
      const checkingExisting = !!row.website && !OVERWRITE
      const siteToCheck = checkingExisting ? row.website : claimedSite
      if (siteToCheck) {
        const url = /^https?:\/\//i.test(siteToCheck) ? siteToCheck.replace(/^http:/i, 'https:') : `https://${siteToCheck}`
        const chk = await checkWebsite(url)
        websiteOk = chk.ok
        if (chk.ok && !checkingExisting && !siteMentionsPlace(chk.html, [row.city.name, row.neighborhood], row.city.country, chk.finalUrl, [r.phone, row.phone])) {
          websiteOk = false
          if (visibleTextLength(chk.html) < MIN_READABLE_TEXT) {
            // A script-only shell: nothing to read, so nothing proven either way.
            console.log(`   website ${url}: page has no readable text, can't confirm it's this venue — not stored, check it by hand`)
          } else {
            // Plenty of text and never says where it is: a same-named venue elsewhere.
            wrongVenue = true
            console.log(`   website ${url}: never mentions ${row.city.name} — looks like another venue, not stored`)
          }
        } else if (chk.ok) {
          siteHtml = chk.html; siteUrl = chk.finalUrl
        } else if (checkingExisting) {
          console.log(`   ⚠ website on file ${url}: ${chk.why} — left as is, check it by hand`)
        } else {
          console.log(`   website ${url}: ${chk.why} — not stored`)
        }
      }

      const { patch, skipped } = buildFillPatch(row, r, {
        overwrite: OVERWRITE, websiteOk, wrongVenue, country: row.city.country,
        placeNames: [row.neighborhood, row.city.name],
      })

      // Cover from the venue's own site, only when the row has none.
      let cover: CoverCandidate | undefined
      if (!NO_COVER && !row.coverImage) {
        if (siteHtml) {
          const c = await coverFromSite(siteHtml, siteUrl)
          if (c.cover) cover = c.cover
          else skipped.coverImage = c.why ?? 'no cover'
        } else {
          skipped.coverImage = 'no verified website to take an og:image from'
        }
      }

      for (const [k, v] of Object.entries(patch)) {
        const shown = k === 'hours' ? hoursLine(v as FillPatch['hours'])
                    : Array.isArray(v) ? v.join(', ')
                    : String(v)
        console.log(`   ${k} → ${shown}`)
      }
      if (cover) console.log(`   coverImage → og:image ${cover.width}x${cover.height} ${cover.url}`)
      const skips = Object.entries(skipped).filter(([k]) => !(k in patch))
      if (skips.length) console.log(`   skipped: ${skips.map(([k, why]) => `${k}: ${why}`).join('; ')}`)

      const fields = [...Object.keys(patch), ...(cover ? ['coverImage'] : [])]
      if (!fields.length) { console.log('   nothing to fill'); unchanged++; continue }

      if (!WRITE) { console.log(`   would write ${fields.length} field(s)`); written++; continue }

      const data: Record<string, unknown> = { ...patch }
      if (cover) data.coverImage = await saveCover(cover)
      await prisma.business.update({ where: { id: row.id }, data })
      await writeAudit(SCRIPT_ACTOR.id, SCRIPT_ACTOR.name, 'directory.fill', row.id, 'business', {
        name: row.name, fields, sources: (r.sources ?? []).slice(0, 5), cityId: row.cityId,
      })
      console.log(`   ✓ written ${fields.length} field(s)`)
      written++
    } catch (e) {
      console.error(`   ✗ ${(e as Error).message}`)
      failed++
    }
    await sleep(ROW_DELAY_MS)
  }

  console.log(`\n${WRITE ? '✓' : '✓ Dry run —'} ${written} ${WRITE ? 'written' : 'would be written'}, ${unchanged} nothing to fill, ${flagged} flagged for a human, ${failed} failed`)
  if (!WRITE && written) console.log('  Re-run with --write to apply.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
