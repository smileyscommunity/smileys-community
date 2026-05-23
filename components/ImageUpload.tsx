'use client'

import { useState, useRef, useCallback } from 'react'
import { resolveImageUrl } from '@/lib/data'

interface Props {
  value: string
  onChange: (url: string) => void
  label?: string
  folder?: 'events' | 'clubs' | 'users' | 'general'
  position?: number
  onPositionChange?: (pos: number) => void
}

export default function ImageUpload({ value, onChange, label = 'Cover image', folder = 'general', position = 50, onPositionChange }: Props) {
  const [uploading,  setUploading]  = useState(false)
  const [progress,   setProgress]   = useState(0)
  const [dragOver,   setDragOver]   = useState(false)
  const [error,      setError]      = useState('')
  const inputRef  = useRef<HTMLInputElement>(null)
  const dragCount = useRef(0) // counter avoids flicker from child element enter/leave

  async function handleFile(file: File) {
    setError('')

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowed.includes(file.type)) { setError('Unsupported file type — use JPG, PNG, WebP, or GIF'); return }
    if (file.size > 5 * 1024 * 1024)  { setError('File too large — max 5 MB'); return }

    setUploading(true)
    setProgress(0)

    // Simulate progress while uploading (XHR would give real progress, but fetch is simpler)
    const tick = setInterval(() => setProgress(p => Math.min(p + 12, 85)), 120)

    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', folder)
      const res  = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      clearInterval(tick)
      if (!res.ok) { setError(data.error ?? 'Upload failed'); return }
      setProgress(100)
      onChange(data.url)
    } catch {
      setError('Upload failed')
    } finally {
      clearInterval(tick)
      setTimeout(() => { setUploading(false); setProgress(0) }, 300)
    }
  }

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCount.current++
    setDragOver(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCount.current--
    if (dragCount.current === 0) setDragOver(false)
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCount.current = 0
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [folder])

  return (
    <div>
      <label className="block text-xs font-semibold text-zinc-400 mb-1.5">{label}</label>

      {/* Drop zone — wraps both the empty state and the preview */}
      <div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={`relative rounded-xl transition-all duration-150 ${
          dragOver ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-zinc-900' : ''
        }`}
      >
        {value ? (
          /* ── Preview state ── */
          <div className="relative group">
            <img
              src={resolveImageUrl(value)}
              alt="Cover"
              className={`w-full h-44 object-cover rounded-xl border transition-all duration-150 ${
                dragOver ? 'border-amber-400 brightness-50' : 'border-zinc-700'
              }`}
              style={{ objectPosition: `center ${position}%` }}
            />

            {/* Drag-over overlay */}
            {dragOver && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl pointer-events-none">
                <svg className="w-10 h-10 text-amber-400 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span className="text-sm font-semibold text-amber-300">Drop to replace</span>
              </div>
            )}

            {/* Upload progress overlay */}
            {uploading && (
              <div className="absolute inset-0 bg-black/60 rounded-xl flex flex-col items-center justify-center gap-3">
                <div className="w-3/4 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 rounded-full transition-all duration-150"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-xs text-zinc-300">Uploading…</span>
              </div>
            )}

            {/* Hover actions (only when not dragging or uploading) */}
            {!dragOver && !uploading && (
              <div className="absolute inset-0 bg-black/50 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="text-xs px-3 py-1.5 bg-white text-gray-900 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => onChange('')}
                  className="text-xs px-3 py-1.5 bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600 transition-colors"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        ) : (
          /* ── Empty / drop zone state ── */
          <div
            onClick={() => !uploading && inputRef.current?.click()}
            className={`w-full h-44 rounded-xl border-2 border-dashed transition-all duration-150 cursor-pointer flex flex-col items-center justify-center gap-2 select-none ${
              dragOver
                ? 'border-amber-400 bg-amber-500/10 text-amber-400'
                : uploading
                ? 'border-zinc-600 bg-zinc-800/50 cursor-default'
                : 'border-zinc-600 text-zinc-500 hover:border-amber-500 hover:bg-amber-500/5 hover:text-amber-400'
            }`}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-3 w-full px-8">
                <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 rounded-full transition-all duration-150"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-xs text-zinc-400">Uploading… {progress}%</span>
              </div>
            ) : dragOver ? (
              <>
                <svg className="w-10 h-10 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span className="text-sm font-semibold">Drop to upload</span>
              </>
            ) : (
              <>
                <svg className="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm font-medium">Drop image here or click to browse</span>
                <span className="text-xs opacity-60">JPG, PNG, WebP — max 5 MB</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Focal point slider — only shown when an image is uploaded and position control is enabled */}
      {value && onPositionChange && (
        <div className="mt-2 flex items-center gap-3">
          <span className="text-[10px] text-zinc-500 shrink-0">Top</span>
          <input
            type="range"
            min={0}
            max={100}
            value={position}
            onChange={e => onPositionChange(Number(e.target.value))}
            className="flex-1 h-1 accent-amber-500 cursor-pointer"
          />
          <span className="text-[10px] text-zinc-500 shrink-0">Bottom</span>
          <span className="text-[10px] text-zinc-400 shrink-0 w-12 text-right">
            {position === 50 ? 'Center' : position === 0 ? 'Top' : position === 100 ? 'Bottom' : `${position}%`}
          </span>
        </div>
      )}

      {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.gif"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />

      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Or paste an image URL…"
        className="mt-2 w-full px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 text-zinc-300 placeholder-zinc-600"
      />
    </div>
  )
}
