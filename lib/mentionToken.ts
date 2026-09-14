// The shape of an @mention, shared by the server resolver (lib/mentions) and
// the client composer/renderers, which must not import prisma. Use with the
// `u` flag. `\w` without it is [A-Za-z0-9_]: "@Çağla" was no token at all and
// "@Ayşe" stopped at "Ay", which the old prefix lookup then fanned out to
// every Ayla, Aylin and Ayhan. \p{M} keeps a decomposed letter (C + combining
// cedilla, as some keyboards and pastes produce) inside the name. Hyphens and
// apostrophes count only between letters: Jean-Luc, O'Brien, Ayşe'ye.
export const MENTION_NAME = String.raw`\p{L}\p{M}*[\p{L}\p{M}\p{N}_]*(?:[-'’][\p{L}\p{M}\p{N}_]+)*`
