import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'

/**
 * The editor's extension set, in one place so a test can check it.
 *
 * It lived inside RichTextEditor's useEditor() call, which meant nothing
 * verified it except a person opening the editor and typing. The tiptap
 * packages had drifted apart in the lockfile (extension-image on 3.28.0 while
 * core sat on 3.23.6, which is what blocked `npm audit fix`), and realigning
 * them on 3.30.2 moves every extension at once. A schema built from this list
 * is DOM-free, so `tests/richTextExtensions.test.ts` can assert the whole
 * configuration still resolves against the installed tiptap — the check that
 * would actually have caught a breaking rename.
 *
 * Static by design: no component state belongs here, which is the only reason
 * it can be hoisted out of the hook at all.
 */
export const richTextExtensions = [
  // Headings are capped at h2/h3. StarterKit defaults to levels 1–6, and
  // its markdown input rule means typing "# " would mint an <h1> that
  // competes with the article title for the page's single top-level
  // heading — and "#####" levels the template doesn't style.
  StarterKit.configure({ heading: { levels: [2, 3] } }),
  Underline,
  TextStyle,
  Color,
  // Links: typed/pasted URLs auto-link (autolink), and the toolbar 🔗
  // button links a selection. openOnClick off so clicks edit, not navigate.
  Link.configure({
    openOnClick: false,
    autolink: true,
    HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
  }),
  // Block images (not inline) uploaded via the toolbar 🖼 button. The
  // src is always our own /api/files path, which survives sanitize().
  Image.configure({
    inline: false,
    HTMLAttributes: { class: 'rounded-lg max-w-full h-auto' },
  }),
]
