import { describe, it, expect } from 'vitest'
import { sanitize, sanitizeArticle } from '@/lib/sanitize'

// sanitizeArticle() exists to let RichTextEditor's colour picker survive to the
// published page. The whole reason `style` is banned on the strict sanitizer is
// that it turns member-authored text into a CSS injection surface, so these
// tests pin the narrow shape of the exception: `color` on `<span>`, nothing else.

describe('sanitizeArticle — colour passes through', () => {
  it('keeps a hex colour on a span', () => {
    expect(sanitizeArticle('<p><span style="color: #f59e0b">amber</span></p>'))
      .toBe('<p><span style="color:#f59e0b">amber</span></p>')
  })

  it('keeps rgb() and rgba() — what the browser normalizes hex to on re-edit', () => {
    expect(sanitizeArticle('<span style="color: rgb(245, 158, 11)">x</span>')).toContain('rgb(245, 158, 11)')
    expect(sanitizeArticle('<span style="color: rgba(245, 158, 11, 0.5)">x</span>')).toContain('rgba(245, 158, 11, 0.5)')
  })

  it('still strips colour for the strict sanitizer used on member content', () => {
    expect(sanitize('<p><span style="color: #f59e0b">amber</span></p>'))
      .toBe('<p><span>amber</span></p>')
  })
})

describe('sanitizeArticle — everything else about style stays blocked', () => {
  it('drops every property other than color, keeping the colour', () => {
    const out = sanitizeArticle(
      '<span style="color: #fff; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 99">overlay</span>',
    )
    // A fake-UI overlay needs positioning; only the recolour survives.
    expect(out).toContain('color:#fff')
    for (const prop of ['position', 'top', 'left', 'width', 'height', 'z-index']) {
      expect(out).not.toContain(prop)
    }
  })

  it('drops a url() beacon smuggled as a colour or background', () => {
    const out = sanitizeArticle('<span style="background-image: url(https://evil.example/p.gif); color: url(https://evil.example/q.gif)">x</span>')
    expect(out).not.toContain('evil.example')
    expect(out).not.toContain('url(')
  })

  it('rejects a colour value that is not a hex/rgb literal', () => {
    // `expression()` and var() lookups are the classic CSS-value escapes.
    expect(sanitizeArticle('<span style="color: expression(alert(1))">x</span>')).not.toContain('expression')
    expect(sanitizeArticle('<span style="color: var(--x)">x</span>')).not.toContain('var(')
  })

  it('does not allow style on any tag other than span', () => {
    expect(sanitizeArticle('<p style="color: #f00">x</p>')).toBe('<p>x</p>')
    expect(sanitizeArticle('<h2 style="color: #f00">x</h2>')).toBe('<h2>x</h2>')
    expect(sanitizeArticle('<img src="https://x.test/a.jpg" style="position: fixed" />')).not.toContain('style')
  })

  it('keeps the tag and scheme rules identical to sanitize()', () => {
    expect(sanitizeArticle('<script>alert(1)</script><p onclick="alert(1)">x</p>')).toBe('<p>x</p>')
    expect(sanitizeArticle('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript')
    expect(sanitizeArticle('<img src="http://x.test/a.jpg" />')).not.toContain('http://')
    // Editor output: headings, lists (TipTap wraps li text in <p>), links, images.
    const editorHtml = '<h2>H</h2><ul><li><p>one</p></li></ul><a href="https://x.test">l</a><img src="/api/files/posts/a.jpg" />'
    expect(sanitizeArticle(editorHtml)).toBe(
      '<h2>H</h2><ul><li><p>one</p></li></ul><a href="https://x.test" target="_blank" rel="noopener noreferrer">l</a><img src="/api/files/posts/a.jpg" />',
    )
  })
})
