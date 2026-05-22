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
      ['tests/*.server.test.ts', 'node'],
    ],
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
