// Shared schema-validators for the admin + owner directory PATCH
// surfaces. Centralizing keeps the field allowlist identical between
// the two routes — an owner can't ship a field the admin couldn't, and
// vice versa, just by hitting a different URL.

import { Prisma } from '@prisma/client'
import { isSafeHref } from '@/lib/safeUrl'
import {
  BUSINESS_CATEGORY_SET,
  DIRECTORY_LIMITS,
  normalizeInstagramHandle,
} from '@/lib/directory'
import { parseHours } from '@/lib/businessHours'

export function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  return s.slice(0, max)
}

// Coordinate parser shared by create + field-update. Returns:
//   undefined  → key not present, don't touch the column
//   null       → key present but empty, clear the override
//   number     → valid coord
//   'invalid'  → out-of-range or unparseable, bubble up an error
export function parseCoord(v: unknown, isLon = false): number | null | undefined | 'invalid' {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 'invalid'
  const lo = isLon ? -180 : -90
  const hi = isLon ?  180 :  90
  if (n < lo || n > hi) return 'invalid'
  return n
}

// Normalize a single business payload for admin create / bulk-create.
export function validateBusinessCreate(input: Record<string, unknown>):
  | { data: Record<string, unknown> }
  | { error: string }
{
  const name        = str(input.name,        DIRECTORY_LIMITS.name)
  const category    = str(input.category,    50)
  const description = str(input.description, DIRECTORY_LIMITS.description)
  if (!name)        return { error: 'Name is required' }
  if (!category)    return { error: 'Category is required' }
  if (!description) return { error: 'Description is required' }
  if (!BUSINESS_CATEGORY_SET.has(category)) {
    return { error: `Invalid category "${category}"` }
  }

  const data: Record<string, unknown> = {
    name,
    category,
    description,
    neighborhood: str(input.neighborhood, DIRECTORY_LIMITS.neighborhood),
    address:      str(input.address,      DIRECTORY_LIMITS.address),
    phone:        str(input.phone,        DIRECTORY_LIMITS.phone),
    languages:    str(input.languages,    DIRECTORY_LIMITS.languages),
    isExpatOwned:    !!input.isExpatOwned,
    isExpatFriendly: !!input.isExpatFriendly,
  }

  const lat = parseCoord(input.latitude)
  if (lat === 'invalid') return { error: 'Invalid latitude (must be -90..90)' }
  if (lat !== undefined) data.latitude = lat
  const lon = parseCoord(input.longitude, true)
  if (lon === 'invalid') return { error: 'Invalid longitude (must be -180..180)' }
  if (lon !== undefined) data.longitude = lon

  if ('hours' in input) {
    const parsed = parseHours(input.hours)
    if ('error' in parsed) return { error: parsed.error }
    if (parsed.hours) data.hours = parsed.hours
  }
  if ('memberDiscount' in input) {
    const v = str(input.memberDiscount, DIRECTORY_LIMITS.memberDiscount)
    if (v) data.memberDiscount = v
  }

  const websiteRaw = str(input.website, DIRECTORY_LIMITS.website)
  if (websiteRaw) {
    if (!isSafeHref(websiteRaw)) return { error: 'Website must be an https:// URL' }
    data.website = websiteRaw
  } else {
    data.website = null
  }

  if (typeof input.instagram === 'string' && input.instagram.trim()) {
    const handle = normalizeInstagramHandle(input.instagram)
    if (!handle) return { error: 'Invalid Instagram handle' }
    data.instagram = handle
  } else {
    data.instagram = null
  }

  for (const k of ['logo', 'coverImage'] as const) {
    const v = str(input[k], DIRECTORY_LIMITS[k])
    if (v === null) {
      data[k] = null
    } else if (!isSafeHref(v)) {
      return { error: `${k} must be an https:// URL` }
    } else {
      data[k] = v
    }
  }

  return { data }
}

// Schema-validate a PATCH field update. Returns either { data: validated
// patch } (only allowed keys, each through its normalizer) or { error:
// '...' } on the first invalid value.
export function validateFieldUpdate(input: Record<string, unknown>):
  | { data: Record<string, unknown> }
  | { error: string }
{
  const data: Record<string, unknown> = {}

  if ('name' in input) {
    const v = str(input.name, DIRECTORY_LIMITS.name)
    if (!v) return { error: 'Name cannot be empty' }
    data.name = v
  }
  if ('category' in input) {
    const v = str(input.category, 50)
    if (!v || !BUSINESS_CATEGORY_SET.has(v)) return { error: 'Invalid category' }
    data.category = v
  }
  if ('description' in input) {
    const v = str(input.description, DIRECTORY_LIMITS.description)
    if (!v) return { error: 'Description cannot be empty' }
    data.description = v
  }
  if ('neighborhood' in input) data.neighborhood = str(input.neighborhood, DIRECTORY_LIMITS.neighborhood)
  if ('address'      in input) data.address      = str(input.address,      DIRECTORY_LIMITS.address)
  if ('phone'        in input) data.phone        = str(input.phone,        DIRECTORY_LIMITS.phone)
  if ('languages'    in input) data.languages    = str(input.languages,    DIRECTORY_LIMITS.languages)

  if ('website' in input) {
    const v = str(input.website, DIRECTORY_LIMITS.website)
    if (v === null) {
      data.website = null
    } else if (!isSafeHref(v)) {
      return { error: 'Website must start with https://' }
    } else {
      data.website = v
    }
  }
  if ('instagram' in input) {
    if (typeof input.instagram !== 'string' || !input.instagram.trim()) {
      data.instagram = null
    } else {
      const handle = normalizeInstagramHandle(input.instagram)
      if (!handle) return { error: 'Invalid Instagram handle' }
      data.instagram = handle
    }
  }
  for (const k of ['logo', 'coverImage'] as const) {
    if (k in input) {
      const v = str(input[k], DIRECTORY_LIMITS[k])
      if (v === null) {
        data[k] = null
      } else if (!isSafeHref(v)) {
        return { error: `${k} must be an https:// URL` }
      } else {
        data[k] = v
      }
    }
  }
  if ('isExpatOwned'    in input) data.isExpatOwned    = !!input.isExpatOwned
  if ('isExpatFriendly' in input) data.isExpatFriendly = !!input.isExpatFriendly

  if ('latitude' in input) {
    const v = parseCoord(input.latitude)
    if (v === 'invalid') return { error: 'Invalid latitude (must be -90..90)' }
    data.latitude = v ?? null
  }
  if ('longitude' in input) {
    const v = parseCoord(input.longitude, true)
    if (v === 'invalid') return { error: 'Invalid longitude (must be -180..180)' }
    data.longitude = v ?? null
  }

  if ('hours' in input) {
    const parsed = parseHours(input.hours)
    if ('error' in parsed) return { error: parsed.error }
    data.hours = parsed.hours ?? Prisma.JsonNull
  }
  if ('memberDiscount' in input) {
    data.memberDiscount = str(input.memberDiscount, DIRECTORY_LIMITS.memberDiscount)
  }

  return { data }
}
