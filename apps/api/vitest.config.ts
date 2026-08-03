import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Refuses a non-local DATABASE_URL before any suite runs — see the file.
    setupFiles: ['test/setup/guardDatabaseUrl.ts'],
  },
})
