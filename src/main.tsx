import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import App from './App'
import { initDb } from './api/campaigns'
import { ThemeProvider } from './components/Theme'
import { legacyHashPath } from './utils/legacyHashRoute'
import './styles/tokens.css'
import './index.css'
import './styles/public.css'

// ── OAuth callback interception ───────────────────────────────────────────────
// Instagram (and other platforms) redirect the popup window to /oauth/callback
// after the user grants or denies access. The popup has no app to show: we
// intercept the path here — before React mounts, so no route ever renders for
// it — forward the result to the opener window, then close the popup. The
// PlatformConnectionModal in the main window receives the result and completes
// the connection flow.
//
// The result is published over THREE same-origin channels because a direct
// window.opener.postMessage is not reliable: some authorization servers (notably
// Bluesky's bsky.social) send Cross-Origin-Opener-Policy, which severs the
// window.opener link — leaving `window.opener` null here and `popup.closed`
// reading `true` in the opener, so the flow was reported as "cancelled" even
// after a successful login. BroadcastChannel and localStorage are unaffected by
// COOP. Keep OAUTH_CHANNEL/OAUTH_RESULT_KEY in sync with PlatformConnectionModal.
if (window.location.pathname === '/oauth/callback') {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')
  const state = params.get('state')

  // Only report when there is something meaningful to report.
  // Limit string lengths to prevent log-injection via crafted redirect params.
  if (code || error) {
    const payload = {
      type: 'oauth_callback' as const,
      code: code ? String(code).substring(0, 2000) : null,
      error: error ? String(error).substring(0, 200) : null,
      state: state ? String(state).substring(0, 200) : null,
    }

    // Channel 1: localStorage — survives COOP and any postMessage/close race,
    // since the write is synchronous and durable. The opener polls for it.
    try {
      localStorage.setItem('oauth_callback_result', JSON.stringify({ ...payload, ts: Date.now() }))
    } catch {
      /* storage unavailable — other channels still apply */
    }

    // Channel 2: BroadcastChannel — same-origin, unaffected by COOP.
    try {
      const bc = new BroadcastChannel('oauth_callback')
      bc.postMessage(payload)
      bc.close()
    } catch {
      /* BroadcastChannel unsupported — localStorage covers it */
    }

    // Channel 3: legacy direct postMessage — works when the opener link survives.
    if (window.opener) {
      window.opener.postMessage(payload, window.location.origin)
    }
  }
  window.close()
} else {
  // Old hash links (/#/how-it-works) from before BrowserRouter: move them to
  // the real path before the router reads the URL.
  const legacy = legacyHashPath(window.location.hash, window.location.search)
  if (legacy) window.history.replaceState(null, '', legacy)

  // Normal app startup — initialise DB and mount React.
  initDb()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </React.StrictMode>,
  )
}
