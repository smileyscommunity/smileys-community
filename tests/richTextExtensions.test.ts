import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import { richTextExtensions } from '@/components/richTextExtensions'

// The tiptap packages had drifted: extension-image resolved to 3.28.0 while
// core sat on 3.23.6, because two extensions were bumped on their own and the
// lockfile pinned the rest. npm then refused to resolve the tree at all, which
// is why `npm audit fix` couldn't run and every install needed
// --legacy-peer-deps. Realigning them on 3.30.2 moves all 31 packages at once.
//
// getSchema builds the ProseMirror schema from the real extension list without
// touching a DOM, so it runs under vitest's node environment. That exercises
// every `.configure()` call against the installed tiptap — a renamed or removed
// option shows up here rather than when someone opens the editor to write a
// post. tsc catches the type-level half of that; this is the runtime half.

const schema = getSchema(richTextExtensions)

describe('rich text editor schema', () => {
  it('builds against the installed tiptap', () => {
    expect(schema.topNodeType.name).toBe('doc')
  })

  it('has the nodes the toolbar and articles depend on', () => {
    for (const node of ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'image']) {
      expect(schema.nodes[node], `missing node: ${node}`).toBeDefined()
    }
  })

  it('has the marks the toolbar exposes, including the colour pair', () => {
    // Color writes through TextStyle — if either stopped registering, the
    // colour buttons would silently no-op.
    for (const mark of ['bold', 'italic', 'underline', 'strike', 'link', 'textStyle', 'code']) {
      expect(schema.marks[mark], `missing mark: ${mark}`).toBeDefined()
    }
  })

  it('still caps headings at h2/h3', () => {
    // StarterKit defaults to 1–6. If the configure() shape changed, this would
    // quietly revert and let an <h1> compete with the article title.
    const heading = richTextExtensions.find(e => e.name === 'heading' || (e as any).config?.name === 'heading')
    const levels = (heading as any)?.options?.levels
      ?? (richTextExtensions.find(e => e.name === 'starterKit') as any)?.options?.heading?.levels
    expect(levels).toEqual([2, 3])
  })

  it('keeps images as blocks, not inline', () => {
    expect(schema.nodes.image.isInline).toBe(false)
  })

  it('renders a link with the rel/target we set, not tiptap defaults', () => {
    const link = schema.marks.link.create({ href: 'https://example.com' })
    const [tag, attrs] = link.type.spec.toDOM!(link, false) as [string, Record<string, string>]
    expect(tag).toBe('a')
    expect(attrs.rel).toBe('noopener noreferrer')
    expect(attrs.target).toBe('_blank')
  })

  it('renders an image with the layout classes the articles are styled around', () => {
    const img = schema.nodes.image.create({ src: '/app/api/files/posts/x.jpg' })
    const [tag, attrs] = img.type.spec.toDOM!(img) as [string, Record<string, string>]
    expect(tag).toBe('img')
    expect(attrs.class).toBe('rounded-lg max-w-full h-auto')
    expect(attrs.src).toBe('/app/api/files/posts/x.jpg')
  })
})
