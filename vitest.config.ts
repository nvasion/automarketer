import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    setupFiles: ['tests/setup.ts'],
    // Route server-side tests to the Node environment; everything else uses jsdom.
    // Test files can also override via the `@vitest-environment <name>` docblock.
    environmentMatchGlobs: [
      // Auth/server tests need real Node.js modules (http, bcrypt, etc.)
      ['tests/*.server.test.ts', 'node'],
      // E2E auth tests use Supertest which requires Node's http module
      ['tests/e2e/auth-workflow.e2e.test.ts', 'node'],
      // Social posting tests use vi.stubGlobal(fetch) and platform connectors
      ['tests/e2e/social-posting-workflow.e2e.test.ts', 'node'],
      // Queue tests exercise real connectors with mocked fetch
      ['tests/e2e/queue-workflow.e2e.test.ts', 'node'],
      ['tests/services/queue/**', 'node'],
    ],
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    // Allow individual tests to opt into longer timeouts (e.g. bcrypt, network).
    // The default 5 s is too tight for bcrypt-12 on slow CI machines.
    testTimeout: 30_000,
  },
})
