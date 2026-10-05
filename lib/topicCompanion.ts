import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'

// The live row behind a lib/topicPairs slug — title and excerpt only, and only
// while it is published, so a link never points at a draft or a 404.
export const getTopicCompanion = unstable_cache(
  async (slug: string, kind: 'handbook' | 'community') => prisma.post.findFirst({
    where:  { slug, kind, status: 'published' },
    select: { slug: true, title: true, excerpt: true },
  }),
  ['topic-companion'],
  { revalidate: 300, tags: ['handbook'] },
)
