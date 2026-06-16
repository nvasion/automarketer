import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import App from './App'
import { initDb } from './api/campaigns'
import './index.css'

// ── OAuth callback interception ───────────────────────────────────────────────
// Instagram (and other platforms) redirect the popup window to /oauth/callback
// after the user grants or denies access.  HashRouter only handles routes that
// start with '#', so a plain /oauth/callback path is invisible to React Router.
// We intercept it here — before React mounts — forward the result to
// window.opener via postMessage, then close the popup.
// The PlatformConnectionModal in the main window receives the message and
// completes the connection flow.
if (window.location.pathname === '/oauth/callback') {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')
  const state = params.get('state')

  // Only post a message when there is something meaningful to report.
  // Limit string lengths to prevent log-injection via crafted redirect params.
  if (window.opener && (code || error)) {
    window.opener.postMessage(
      {
        type: 'oauth_callback',
        code: code ? String(code).substring(0, 2000) : null,
        error: error ? String(error).substring(0, 200) : null,
        state: state ? String(state).substring(0, 200) : null,
      },
      window.location.origin,
    )
  }
  window.close()
} else {
  // Normal app startup — initialise DB and mount React.
  initDb()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <HashRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </HashRouter>
    </React.StrictMode>,
  )
}
