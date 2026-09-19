// What a member may save on their own profile (PATCH /api/auth/me). Every
// value here ends up rendered on someone else's screen or matched by a
// filter, and the route used to copy most of them through unchecked: a
// colour string went into inline styles on every avatar, a 10,000-item
// interest list into the directory, a free-text gender into the
// connection-abuse scan that keys on it.
import { SOCIAL_STYLES } from '@/lib/socialStyles'
import { LOOKING_FOR_VALUES } from '@/lib/profileOptions'
import { normalizeInstagramHandle } from '@/lib/directory-constants'

// The values /apply writes. The abuse scans read the application's copy, so
// changing this one can't hide anyone from them.
export const GENDERS = ['female', 'male', 'non_binary', 'prefer_not_to_say'] as const
export const PROFILE_VISIBILITIES = ['everyone', 'connections'] as const

const SOCIAL_STYLE_IDS = new Set<string>(SOCIAL_STYLES.map(s => s.id))
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

type Result = { ok: true; value: unknown } | { ok: false; error: string }
const ok = (value: unknown): Result => ({ ok: true, value })
const bad = (error: string): Result => ({ ok: false, error })

function stringList(v: unknown, label: string, max: number, maxLen: number): Result {
  if (!Array.isArray(v)) return bad(`${label} must be a list`)
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') return bad(`${label} must be a list of text`)
    const t = item.trim().replace(/\s+/g, ' ')
    if (!t) continue
    if (t.length > maxLen) return bad(`Each of your ${label} can be up to ${maxLen} characters`)
    if (!out.some(o => o.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  if (out.length > max) return bad(`You can list up to ${max} ${label}`)
  return ok(out)
}

// Ids no longer on offer are dropped, not refused: an application approved
// before the current set carried them over, the editor can't show (or
// remove) them, and refusing would block every save of the field.
function closedList(v: unknown, label: string, allowed: Set<string>, max: number): Result {
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) return bad(`${label} invalid`)
  const out = [...new Set((v as string[]).filter(x => allowed.has(x)))]
  if (out.length > max) return bad(`Pick up to ${max} ${label}`)
  return ok(out)
}

// Returns the value to store, or the message to show. Only called for keys
// present in the request body.
export function validateProfileField(key: string, v: unknown): Result {
  switch (key) {
    case 'color':
      return typeof v === 'string' && HEX_COLOR.test(v) ? ok(v.toLowerCase()) : bad('Pick one of the colours')
    case 'profileVisibility':
      return (PROFILE_VISIBILITIES as readonly unknown[]).includes(v) ? ok(v) : bad('profileVisibility invalid')
    case 'gender':
      return (GENDERS as readonly unknown[]).includes(v) ? ok(v) : bad('Pick one of the gender options')
    // The same caps /apply takes, so nothing an application brought in is
    // unsaveable here.
    case 'interests':
      return stringList(v, 'interests', 30, 50)
    case 'languages':
      return stringList(v, 'languages', 20, 50)
    case 'socialStyles':
      // The editor caps the pick at three.
      return closedList(v, 'social styles', SOCIAL_STYLE_IDS, 3)
    case 'lookingFor':
      return closedList(v, 'options', LOOKING_FOR_VALUES, LOOKING_FOR_VALUES.size)
    case 'bio':
      if (v === null || v === '') return ok(null)
      if (typeof v !== 'string') return bad('Bio invalid')
      return v.length > 1000 ? bad('Bio too long') : ok(v.trim() || null)
    case 'instagram': {
      if (v === null || (typeof v === 'string' && !v.trim())) return ok(null)
      if (typeof v !== 'string' || v.length > 100) return bad('Instagram handle too long')
      // A pasted profile URL is stored as the handle every surface links from.
      const handle = normalizeInstagramHandle(v)
      return handle ? ok(handle) : bad('That doesn\'t look like an Instagram handle')
    }
    case 'linkedin': {
      if (v === null || (typeof v === 'string' && !v.trim())) return ok(null)
      // 200, the same as /apply — a share URL with tracking parameters runs
      // past 100, and the editor then refused a value the application took.
      if (typeof v !== 'string' || v.length > 200) return bad('LinkedIn too long')
      return ok(v.trim())
    }
    default:
      return ok(v)
  }
}
