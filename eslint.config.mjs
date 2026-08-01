import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

// Flat config (ESLint 9). `next lint` is deprecated and removed in Next 16,
// and it was never actually configured here — running it dropped into an
// interactive setup prompt, which meant `npm run lint` could not complete in
// CI or any non-interactive shell. This replaces it with the ESLint CLI.
//
// eslint-config-next is still distributed as eslintrc-style, so FlatCompat
// bridges it into flat config; that's the migration path Next documents.
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

export default [
  {
    // Build output and vendored code — linting these is pure noise and
    // .next in particular contains generated files that will never pass.
    ignores: [
      '.next/**',
      'node_modules/**',
      'public/**',
      'next-env.d.ts',
      'prisma/generated/**',
      // Claude Code worktrees are complete repo copies, build output and
      // vendored deps included. Linting them produced ~74k findings across
      // 2,292 files and buried the ~120 real ones in actual source.
      '.claude/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Existing `eslint-disable` comments in this repo reference rules this
    // config doesn't enable (no-control-regex, react/no-danger). ESLint
    // treats those as unused directives and `--fix` DELETES them, which
    // silently discards the author's documented reason for the exception
    // and would leave the code bare if the rule is ever switched on.
    // Keeping them reported-but-not-removed preserves that intent.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
]
