// A stand-in for Postgres running lib/mentions' candidate query against a fake
// users table. It reads the query as Prisma built it — strings and bound
// values — so it applies the translate()/replace() map the query actually
// carries, LIKE / ILIKE ANY with backslash escapes, and only the scope
// predicates actually present in the SQL text. Drop one from the query and
// the rows it guarded come back.
export type MentionRow = { id: string; name: string; status: string; hiddenFromMembers: boolean; cityId: string }
type SqlLike = { strings: string[]; values: unknown[] }

const escapeRe = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

function likeToRegex(pattern: string, flags: string): RegExp {
  const chars = Array.from(pattern)
  let re = ''
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (c === '\\') { re += escapeRe(chars[++i] ?? ''); continue }
    re += c === '%' ? '[\\s\\S]*' : c === '_' ? '[\\s\\S]' : escapeRe(c)
  }
  return new RegExp(`^${re}$`, flags)
}

function pgTranslate(s: string, from: string, to: string): string {
  const f = Array.from(from), t = Array.from(to)
  return Array.from(s, c => { const i = f.indexOf(c); return i < 0 ? c : (t[i] ?? '') }).join('')
}

export function parseMentionSql(q: SqlLike) {
  const { strings, values } = q
  const text = strings.join('$')
  const valueAfter = (re: RegExp) => { const i = strings.findIndex((s, k) => k < values.length && re.test(s)); return i < 0 ? undefined : values[i] }
  const t = strings.findIndex(s => /translate\(name, $/.test(s))
  if (t < 0) throw new Error('no translate(name, …) in the candidate query')
  const from = values[t] as string, to = values[t + 1] as string
  const replaces: [string, string][] = []
  let k = t + 2
  while (k < values.length && !/LIKE ANY \(ARRAY\[$/.test(strings[k])) { replaces.push([values[k] as string, values[k + 1] as string]); k += 2 }
  const folded: string[] = [], raw: string[] = []
  let into: string[] | null = null
  for (; k < values.length; k++) {
    if (/ILIKE ANY \(ARRAY\[$/.test(strings[k])) into = raw
    else if (/LIKE ANY \(ARRAY\[$/.test(strings[k])) into = folded
    else if (strings[k] !== ',') into = null
    if (!into) throw new Error(`unexpected parameter after ${JSON.stringify(strings[k])}`)
    into.push(values[k] as string)
  }
  return {
    text, from, to, replaces, folded, raw,
    authorId: valueAfter(/id <> $/) as string | undefined,
    cityId:   valueAfter(/"cityId" = $/) as string | undefined,
    limit:    Number(/LIMIT (\d+)/.exec(text)?.[1] ?? Infinity),
  }
}

export function runMentionSql(q: SqlLike, users: MentionRow[]) {
  const p = parseMentionSql(q)
  const fold = (name: string) => p.replaces.reduce((s, [a, b]) => s.split(a).join(b), pgTranslate(name, p.from, p.to)).toLowerCase()
  const approvedOnly = /status = 'approved'/.test(p.text)
  const visibleOnly  = /"hiddenFromMembers" = false/.test(p.text)
  return users
    .filter(u => (!approvedOnly || u.status === 'approved')
      && (!visibleOnly || !u.hiddenFromMembers)
      && (p.authorId === undefined || u.id !== p.authorId)
      && (p.cityId === undefined || u.cityId === p.cityId)
      && (p.folded.some(pat => likeToRegex(pat, 'u').test(fold(u.name)))
        || p.raw.some(pat => likeToRegex(pat, 'iu').test(u.name))))
    .slice(0, p.limit)
    .map(({ id, name }) => ({ id, name }))
}
