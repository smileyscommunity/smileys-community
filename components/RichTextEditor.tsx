'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import { useEffect } from 'react'

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
}

function ToolbarBtn({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${
        active ? 'bg-amber-500 text-white' : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

export default function RichTextEditor({ value, onChange, placeholder, className }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class: 'min-h-[120px] outline-none text-sm text-white leading-relaxed p-3',
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

  if (!editor) return null

  return (
    <div className={`rounded-xl border border-zinc-700 bg-zinc-800 focus-within:ring-2 focus-within:ring-amber-500 overflow-hidden ${className ?? ''}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-zinc-700 bg-zinc-900">
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

        <div className="w-px h-4 bg-zinc-700 mx-1" />

        {/* Color picker */}
        <div className="flex items-center gap-1">
          {COLORS.map(c => (
            <button
              key={c.value}
              type="button"
              onMouseDown={e => {
                e.preventDefault()
                if (c.value) editor.chain().focus().setColor(c.value).run()
                else editor.chain().focus().unsetColor().run()
              }}
              title={c.label}
              className="w-4 h-4 rounded-full border border-zinc-600 transition-transform hover:scale-125"
              style={{ backgroundColor: c.value || '#e4e4e7' }}
            />
          ))}
        </div>

        <div className="w-px h-4 bg-zinc-700 mx-1" />

        <ToolbarBtn active={false} onClick={() => editor.chain().focus().undo().run()} title="Undo">↩</ToolbarBtn>
        <ToolbarBtn active={false} onClick={() => editor.chain().focus().redo().run()} title="Redo">↪</ToolbarBtn>
      </div>

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
