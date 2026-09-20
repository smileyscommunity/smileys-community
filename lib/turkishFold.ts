// Matching names and words the way a member types them.
//
// Two traps, both Turkish, both hit by real names in this community:
//
//   'İpek'.toLowerCase()  →  'i̇pek'   (i + a combining dot, two code points)
//   'Işık'.toLowerCase()  →  'ışık'   (dotless ı, which is not 'i')
//
// So searching "ipek" found nobody called İpek — not in the browser and not
// in Postgres, whose lower() does the same thing. Folding both sides to the
// same plain-ASCII shape is what makes the two agree.
const MAP: Record<string, string> = {
  'ı': 'i', 'İ': 'i', 'ş': 's', 'Ş': 's', 'ğ': 'g', 'Ğ': 'g',
  'ç': 'c', 'Ç': 'c', 'ö': 'o', 'Ö': 'o', 'ü': 'u', 'Ü': 'u',
}

/** Lower-cased, unaccented, dotless-i-safe — for comparing, never for display. */
export function fold(s: string): string {
  return s
    .replace(/[ıİşŞğĞçÇöÖüÜ]/g, ch => MAP[ch] ?? ch)
    .toLowerCase()
    // Anything else with a diacritic (é, ñ, å…) loses it the standard way.
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .trim()
}

// The same fold, in SQL. Postgres has no unaccent extension here, so the
// letters that matter are translated in place: a member typing "ipek",
// "isik" or "andres" finds İpek, Işık and Andrés, and a member typing their
// own name properly still finds them. Kept in step with fold() above — the
// accented letters are the ones these names and interests actually use.
export const SQL_FOLD_FROM = 'ıİşŞğĞçÇöÖüÜáàâäãåÁÀÂÄÃÅéèêëÉÈÊËíìîïÍÌÎÏóòôõÓÒÔÕúùûÚÙÛñÑýÿ'
export const SQL_FOLD_TO   = 'iissggccoouuaaaaaaAAAAAAeeeeEEEEiiiiIIIIooooOOOOuuuUUUnNyy'
