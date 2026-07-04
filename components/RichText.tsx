import React from 'react'

// Shared inline rich-text renderer for member-authored text (club
// announcements, wall posts/replies, club rules, event messages). Renders:
//   • clickable links (http/https)
//   • *bold*  and  _italic_   (WhatsApp-style)
//   • @mentions (highlighted)
// Line breaks are NOT handled here — the parent element keeps
// `whitespace-pre-wrap` so stored newlines render as-is. This component is a
// pure function (no hooks / no 'use client'), so it works in both server and
// client components.

// One pass over the string, matching the first of: url | *bold* | _italic_ | @mention.
// Emphasis (both * and _) requires the markers to sit at word boundaries and
// to wrap non-space content (WhatsApp-style). This keeps pre-existing plain
// text from being reformatted: snake_case / file_names, multiplication
// (`2 * 3`), bullet lines (`* item`), and mid-word markers are all left alone.
const TOKEN_RE = /(https?:\/\/[^\s]+)|((?<![A-Za-z0-9])\*(?!\s)[^*\n]+?(?<!\s)\*(?![A-Za-z0-9]))|((?<![A-Za-z0-9])_(?!\s)[^_\n]+?(?<!\s)_(?![A-Za-z0-9]))|(@\w+)/g
// Punctuation that commonly trails a URL in prose but isn't part of it.
const URL_TRAIL_RE = /[.,!?;:)\]]+$/

export function RichText({ text }: { text: string }) {
  if (!text) return null

  const nodes: React.ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0

  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(<React.Fragment key={key++}>{text.slice(last, m.index)}</React.Fragment>)
    }
    const [full, url, bold, italic, mention] = m

    if (url) {
      // Don't swallow trailing punctuation into the href.
      let href = url
      let trail = ''
      const tm = href.match(URL_TRAIL_RE)
      if (tm) { trail = tm[0]; href = href.slice(0, href.length - trail.length) }
      nodes.push(
        <a key={key++} href={href} target="_blank" rel="noopener noreferrer nofollow"
          className="text-amber-600 underline break-all hover:text-amber-700">{href}</a>,
      )
      if (trail) nodes.push(<React.Fragment key={key++}>{trail}</React.Fragment>)
    } else if (bold) {
      nodes.push(<strong key={key++} className="font-semibold">{bold.slice(1, -1)}</strong>)
    } else if (italic) {
      nodes.push(<em key={key++}>{italic.slice(1, -1)}</em>)
    } else if (mention) {
      nodes.push(<span key={key++} className="font-semibold text-amber-600">{mention}</span>)
    }

    last = m.index + full.length
  }

  if (last < text.length) {
    nodes.push(<React.Fragment key={key++}>{text.slice(last)}</React.Fragment>)
  }

  return <>{nodes}</>
}

export default RichText
