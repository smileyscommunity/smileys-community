import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('story comments', () => {
  it('reading and writing need a session; stories only', () => {
    const r = src('app/api/posts/[slug]/comments/route.ts')
    expect(r).toContain("if (!session) return NextResponse.json({ error: 'Sign in to read comments' }, { status: 401 })")
    expect(r).toContain("if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })")
    expect(r).toContain("post.kind === 'community' && post.status === 'published'")
    expect(r).toContain('rateLimit(`post-comment:${session.id}`')
    expect(r).toContain('SHOWN_REPLY')
  })
  it('removal is soft and limited to author, story author or staff', () => {
    const r = src('app/api/posts/[slug]/comments/[commentId]/route.ts')
    expect(r).toContain('data: { removedAt: new Date() }')
    expect(r).toContain('c.post.authorId !== session.id && !isStaff')
  })
  it('reports reuse the moderation queue and can take the comment down', () => {
    expect(src('app/api/posts/[slug]/comments/[commentId]/report/route.ts')).toContain('postCommentId: commentId')
    expect(src('app/api/admin/moderation/[id]/route.ts')).toContain('prisma.postComment.updateMany')
    expect(src('app/api/admin/moderation/route.ts')).toContain('postComment:')
  })
  it('the story page shows the section outside preview, guests get the count only', () => {
    const page = src('app/posts/[slug]/page.tsx')
    expect(page).toContain('{!preview && !post.commentsOff && <StoryComments')
    expect(src('components/StoryComments.tsx')).toContain('Sign in to')
  })
  it('the migration is additive', () => {
    const m = src('prisma/migrations/20261015000005_story_comments/migration.sql')
    expect(m).not.toMatch(/DROP |UPDATE "|DELETE FROM/)
  })

  it('staff can turn comments off per story: form, API, page and comments route', () => {
    expect(src('app/admin/posts/PostForm.tsx')).toContain('Turn comments off for this story')
    expect(src('app/api/admin/posts/[id]/route.ts')).toContain("typeof payload.commentsOff === 'boolean'")
    expect(src('app/posts/[slug]/page.tsx')).toContain('!post.commentsOff && <StoryComments')
    expect(src('app/api/posts/[slug]/comments/route.ts')).toContain('!post.commentsOff ? post : null')
    expect(src('prisma/migrations/20261015000006_post_comments_off/migration.sql')).toContain('DEFAULT false')
  })
  it('earlier commenters are notified once per story until they read it', () => {
    const r = src('app/api/posts/[slug]/comments/route.ts')
    expect(r).toContain("type: 'story_comment_reply', link, isRead: false")
    expect(r).toContain('userId: { notIn: [session.id, post.authorId] }')
    expect(src('lib/notify.ts')).toContain("story_comment_reply:  'wallReplies'")
  })
})
