import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    // Mirror the `@/...` path alias used across the app.
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // lib/access.ts imports the prisma client at module load, and
    // lib/prisma.ts throws if DATABASE_URL is unset. A dummy URL lets the
    // import succeed — the pure role helpers under test never open a
    // connection.
    env: { DATABASE_URL: 'postgresql://test:test@localhost:5432/test' },
  },
})
