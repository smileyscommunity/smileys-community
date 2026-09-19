'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import { richTextExtensions } from './richTextExtensions'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImageUploadError } from '@/lib/image-resize'
import { prepareImageUpload } from '@/lib/imageUploadGuard'

const COLORS = [
  { label: 'Default',  value: '' },
  { label: 'Amber',    value: '#f59e0b' },
  { label: 'Red',      value: '#ef4444' },
  { label: 'Green',    value: '#22c55e' },
  { label: 'Blue',     value: '#3b82f6' },
  { label: 'Purple',   value: '#a855f7' },
  { label: 'Gray',     value: '#9ca3af' },
]

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string
  // Which upload subfolder inserted images land in. Any valid
  // upload folder works (all serve via /api/files/<folder>/…); defaults
  // to 'posts' since articles are the main image-in-body surface.
  uploadFolder?: string
}

// The action runs on CLICK. It used to run inside onMouseDown, which the
// keyboard never fires — Tab to Bold, press Enter or Space, nothing happened.
// mousedown still preventDefaults so a mouse click doesn't take focus and
// collapse the editor's selection; Enter/Space fire click, and the commands'
// chain().focus() restores the selection the editor kept while blurred.
// `active` is omitted for one-shot actions (undo, image) so only real
// toggles announce aria-pressed.
function ToolbarBtn({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`px-2 py-1 rounded text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
        active ? 'bg-amber-500 text-white' : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

export default function RichTextEditor({ value, onChange, placeholder, className, uploadFolder = 'posts' }: Props) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl,  setLinkUrl]  = useState('')
  const [imgUploading, setImgUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const editor = useEditor({
    extensions: richTextExtensions,
    content: value || '',
    editorProps: {
      attributes: {
        // prose gives paragraphs/headings/lists real vertical spacing while
        // editing (Tailwind preflight strips default margins, so without this
        // everything looked glued together); prose-invert keeps text light on
        // the dark editor surface.
        class: 'prose prose-invert prose-sm max-w-none break-words min-h-[120px] outline-none leading-relaxed p-3',
      },
    },
    onUpdate({ editor }) {
      const html = editor.getHTML()
      // Treat empty editor as empty string
      onChange(html === '<p></p>' ? '' : html)
    },
  })

  // Sync external value changes (e.g. when event data loads)
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (current !== value && value !== undefined) {
      editor.commands.setContent(value || '')
    }
  }, [value, editor])

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !editor) return
    setImgUploading(true)
    try {
      // Same pipeline as cover/photo uploads: downscale client-side, POST to
      // /api/upload, insert the returned /api/files path at the cursor.
      // prepareImageUpload applies the size limit to the shrunk photo, and its
      // ImageUploadError (too large, iCloud-only) is shown verbatim.
      const upload = await prepareImageUpload(file)
      const fd = new FormData()
      fd.append('file', upload)
      fd.append('folder', uploadFolder)
      const r = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: fd }).then(res => res.json())
      if (r?.url) editor.chain().focus().setImage({ src: r.url }).run()
      else toast.error(r?.error ?? 'Image upload failed')
    } catch (err) {
      toast.error(err instanceof ImageUploadError ? err.message : 'Image upload failed')
    } finally {
      setImgUploading(false)
      e.target.value = ''
    }
  }

  if (!editor) return null

  return (
    <div className={`rounded-xl border border-zinc-700 bg-zinc-800 focus-within:ring-2 focus-within:ring-amber-500 overflow-hidden ${className ?? ''}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-zinc-700 bg-zinc-900">
        {/* Headings come FIRST — before bold — because their absence is what
            produced the Handbook's structural problem: with no heading control
            in the toolbar, every author reached for bold instead, and the whole
            corpus ended up with zero real <h2>. A bolded paragraph looks like a
            heading but gives screen readers no outline to navigate and search
            engines no structure. Level 2 and 3 only: the article template
            renders the title as the page's single <h1>. */}
        <ToolbarBtn active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Section heading">
          H2
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Sub-heading">
          H3
        </ToolbarBtn>

        <div className="w-px h-4 bg-zinc-700 mx-1" />

        <ToolbarBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <strong>B</strong>
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <em>I</em>
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
          <span className="underline">U</span>
        </ToolbarBtn>

        <div className="w-px h-4 bg-zinc-700 mx-1" />

        <ToolbarBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
          ≡
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
          1.
        </ToolbarBtn>

        <ToolbarBtn active={editor.isActive('link')} onClick={() => { setLinkUrl(editor.getAttributes('link').href ?? ''); setLinkOpen(o => !o) }} title="Add / edit link">🔗</ToolbarBtn>

        <ToolbarBtn onClick={() => fileInputRef.current?.click()} title="Insert image">
          {imgUploading ? '⏳' : '🖼'}
        </ToolbarBtn>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />

        <div className="w-px h-4 bg-zinc-700 mx-1" />

        {/* Color picker */}
        <div className="flex items-center gap-1">
          {COLORS.map(c => (
            // Same click-not-mousedown rule as ToolbarBtn, so the swatches
            // work from the keyboard too.
            <button
              key={c.value}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                if (c.value) editor.chain().focus().setColor(c.value).run()
                else editor.chain().focus().unsetColor().run()
              }}
              title={c.label}
              aria-label={c.value ? `Text colour: ${c.label}` : 'Default text colour'}
              aria-pressed={c.value ? editor.isActive('textStyle', { color: c.value }) : undefined}
              className="w-4 h-4 rounded-full border border-zinc-600 transition-transform hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              style={{ backgroundColor: c.value || '#e4e4e7' }}
            />
          ))}
        </div>

        <div className="w-px h-4 bg-zinc-700 mx-1" />

        <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} title="Undo">↩</ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} title="Redo">↪</ToolbarBtn>
      </div>

      {/* Link input row — inline (no native prompt(), which no-ops in the PWA).
          Select text, click 🔗, type a URL, Apply. Empty URL removes the link. */}
      {linkOpen && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-zinc-700 bg-zinc-900">
          <input
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const url = linkUrl.trim()
                if (!url) editor.chain().focus().unsetLink().run()
                else editor.chain().focus().extendMarkRange('link').setLink({ href: /^https?:\/\//i.test(url) ? url : `https://${url}` }).run()
                setLinkOpen(false)
              }
              if (e.key === 'Escape') setLinkOpen(false)
            }}
            placeholder="https://…  (leave empty and Apply to remove)"
            autoFocus
            className="flex-1 bg-zinc-800 text-white text-xs px-2 py-1 rounded border border-zinc-700 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          {/* Click, not mousedown, so Tab → Enter/Space works here too. */}
          <button type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              const url = linkUrl.trim()
              if (!url) editor.chain().focus().unsetLink().run()
              else editor.chain().focus().extendMarkRange('link').setLink({ href: /^https?:\/\//i.test(url) ? url : `https://${url}` }).run()
              setLinkOpen(false)
            }}
            className="text-xs font-semibold text-amber-400 hover:text-amber-300 px-2 py-1 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded">
            Apply
          </button>
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setLinkOpen(false)}
            aria-label="Close link editor"
            className="text-xs text-zinc-500 hover:text-zinc-300 px-1 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded">✕</button>
        </div>
      )}

      {/* Editor area */}
      <div className="relative">
        {editor.isEmpty && placeholder && (
          <span className="absolute top-3 left-3 text-sm text-zinc-500 pointer-events-none select-none">{placeholder}</span>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
