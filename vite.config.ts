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
    // Bind to all interfaces so the dev server is reachable inside Docker
    // containers as well as from the host machine.
    host: '0.0.0.0',
    port: 5173,
    open: true,
    // Forward all /api/* requests to the Express server so the browser
    // always talks to a same-origin URL (no cross-origin cookie issues).
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT ?? 3001}`,
        changeOrigin: true,
      },
    },
    hmr: {
      // Default to cloud-proxy settings (port 443, wss).
      // docker-compose.yml overrides these via HMR_CLIENT_PORT / HMR_PROTOCOL
      // so HMR works correctly when the app is accessed on localhost:5173.
      clientPort: process.env.HMR_CLIENT_PORT
        ? parseInt(process.env.HMR_CLIENT_PORT, 10)
        : 443,
      protocol: (process.env.HMR_PROTOCOL === 'ws' ? 'ws' : 'wss') as 'ws' | 'wss',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
