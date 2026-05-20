import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  // Use a relative base so that @vite/client, @react-refresh, and all
  // other dev-server modules are requested relative to the current page URL.
  // This is required when the dev server sits behind a reverse proxy at a
  // subpath (e.g. /api/projects/<id>/preview/) — without it the browser
  // resolves those imports against the domain root, bypassing the proxy and
  // receiving an HTML error page with no Content-Type (NS_ERROR_CORRUPTED_CONTENT).
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    // Allow the HMR WebSocket to connect through the same proxy host/port
    // instead of defaulting to localhost, which is unreachable from the browser
    // when served via the cloud preview proxy.
    hmr: {
      clientPort: 443,
      protocol: 'wss',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
