import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  // Dev server (command === 'serve') may sit behind a reverse proxy at a
  // subpath, so @vite/client, @react-refresh and other dev modules must be
  // requested relative to the current page URL — hence base './' there.
  // (Without it the browser resolves them against the domain root, bypasses the
  // proxy, and gets an HTML error page with no Content-Type.)
  //
  // Production builds are served at the domain root on App Platform and use
  // deep real-path routes like /oauth/callback. With a relative base the
  // browser resolves ./assets/* against /oauth/ and 404s, so the build uses an
  // absolute base.
  base: command === 'serve' ? './' : '/',
  plugins: [react()],
  server: {
    // Bind to all interfaces so the dev server is reachable inside Docker
    // containers as well as from the host machine.
    host: '0.0.0.0',
    port: 5173,
    open: false,
    // Forward all /api/* requests to the Express server so the browser
    // always talks to a same-origin URL (no cross-origin cookie issues).
    proxy: {
      '/api': {
        target: `http://${process.env.API_HOST ?? 'localhost'}:${process.env.API_PORT ?? 3001}`,
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
}))
