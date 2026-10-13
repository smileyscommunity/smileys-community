// Attach (or remove) a RESTRICTED member offer on an article — e.g. an
// organizer-approved discount for private channels only. It is stored in
// post_member_offers and served only by /api/posts/[slug]/offer to signed-in,
// activated members. It is never part of the public page, metadata, JSON-LD
// or analytics.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local \
//     scripts/set-post-member-offer.ts <slug> '{"label":"15% off","url":"https://…","code":"…","note":"…"}'
//   REMOVE=1 npx tsx … scripts/set-post-member-offer.ts <slug>
//
// Refuses when the url/code already appears in the article (body, excerpt,
// cover, eventDetails): that article would be leaking it publicly. The offer
// is never printed back in full.
import { prisma } from '@/lib/prisma'
import { isSafeHref } from '@/lib/safeUrl'

const mask = (s?: string | null) => (s ? `${s.slice(0, 4)}…(${s.length} chars)` : null)

async function main() {
  const [slug, json] = process.argv.slice(2)
  if (!slug) throw new Error('usage: set-post-member-offer.ts <slug> \'<json>\'  (REMOVE=1 to delete)')
  const post = await prisma.post.findUnique({ where: { slug }, select: { id: true, title: true, body: true, excerpt: true, coverImage: true, eventDetails: true } })
  if (!post) throw new Error(`no post with slug ${slug}`)

  if (process.env.REMOVE === '1') {
    if (process.env.DRY_RUN === '1') return console.log('DRY_RUN — would remove the offer on', post.title)
    const r = await prisma.postMemberOffer.deleteMany({ where: { postId: post.id } })
    return console.log(`removed ${r.count} offer(s) from ${post.title}`)
  }

  const o = JSON.parse(json ?? 'null')
  const label = String(o?.label ?? '').trim().slice(0, 160)
  const url = o?.url ? String(o.url).trim() : null
  const code = o?.code ? String(o.code).trim().slice(0, 80) : null
  const note = o?.note ? String(o.note).trim().slice(0, 400) : null
  if (!label) throw new Error('label is required')
  if (!url && !code) throw new Error('give a url, a code, or both')
  if (url && !/^https:\/\//i.test(url)) throw new Error('url must be https')
  if (url && !isSafeHref(url)) throw new Error('url is not a safe link')

  const haystack = [post.body, post.excerpt, post.coverImage, JSON.stringify(post.eventDetails)].join('\n')
  for (const secret of [url, code]) if (secret && haystack.includes(secret)) throw new Error('this url/code already appears in the PUBLIC article — remove it there first')

  console.log(`${post.title}\n  label: ${label}\n  url:   ${mask(url)}\n  code:  ${mask(code)}`)
  if (process.env.DRY_RUN === '1') return console.log('DRY_RUN — nothing written')
  await prisma.postMemberOffer.upsert({
    where: { postId: post.id },
    create: { postId: post.id, label, url, code, note, active: true },
    update: { label, url, code, note, active: true },
  })
  console.log('saved.')
}
main().catch(e => { console.error(e.message ?? e); process.exit(1) }).finally(() => prisma.$disconnect())
