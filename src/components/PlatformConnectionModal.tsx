import { useState, useEffect, useCallback, useContext } from 'react'
import type { PlatformConfig } from '../types'
import { AuthContext } from '../contexts/AuthContext'
import PlatformBadge from './PlatformBadge'
import { PLATFORM_CREDENTIAL_FIELDS, PLATFORM_OAUTH_CONFIG } from '../config/platformConfig'
import { fetchPlatformClientIds } from '../services/platformConfigService'
import type { PlatformClientIds } from '../services/platformConfigService'
import styles from './PlatformConnectionModal.module.css'

// ── Types ────────────────────────────────────────────────────────────────────

type ConnectionMethod = 'oauth' | 'credentials'
/** 'opening' = popup window is being opened; 'authorizing' = waiting for user; 'error' = blocked/failed */
type OAuthStep = 'idle' | 'resolving' | 'opening' | 'authorizing' | 'success' | 'error'
type ConfigLoadState = 'loading' | 'ready' | 'error'

interface Props {
  platform: PlatformConfig
  onClose: () => void
  onConnect: (platformId: string) => void
}

// ── Not-configured notice ──────────────────────────────────────────────────────
// Shown when a platform has no server-side OAuth app configured. Under the
// shared-app model, OAuth apps are configured by the operator via environment
// variables — not pasted in by each user.

function NotConfiguredNotice({ platformName, envPrefix }: { platformName: string; envPrefix: string }) {
  return (
    <div data-testid="platform-not-configured" style={{ textAlign: 'left' }}>
      <div
        style={{
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: '8px',
          padding: '12px 14px',
          fontSize: '13px',
          color: '#92400e',
          lineHeight: 1.5,
        }}
      >
        <strong>{platformName} isn't configured on the server yet.</strong> AutoMarketer
        uses a single shared OAuth app per platform. Ask your administrator to set{' '}
        <code style={{ background: '#fde68a', padding: '1px 5px', borderRadius: '3px' }}>
          {envPrefix}_CLIENT_ID
        </code>{' '}
        and{' '}
        <code style={{ background: '#fde68a', padding: '1px 5px', borderRadius: '3px' }}>
          {envPrefix}_CLIENT_SECRET
        </code>{' '}
        in the server environment, then restart the API server.
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

function PlatformConnectionModal({ platform, onClose, onConnect }: Props) {
  // Read the auth context directly (not via useAuth) so the modal still works
  // when rendered outside an <AuthProvider>, e.g. in tests.
  const auth = useContext(AuthContext)
  const userId = auth?.user?.id ?? 'default'
  const [method, setMethod] = useState<ConnectionMethod>('oauth')
  const [oauthStep, setOauthStep] = useState<OAuthStep>('idle')
  const [oauthError, setOauthError] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [credError, setCredError] = useState<string | null>(null)
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({})
  // Bluesky handle-first flow
  const [blueskyHandle, setBlueskyHandle] = useState('')

  // The signed-in user's client IDs, fetched from the server.
  const [clientIds, setClientIds] = useState<PlatformClientIds | null>(null)
  const [configLoadState, setConfigLoadState] = useState<ConfigLoadState>('loading')

  useEffect(() => {
    let cancelled = false
    fetchPlatformClientIds()
      .then((ids) => {
        if (!cancelled) {
          setClientIds(ids)
          setConfigLoadState('ready')
        }
      })
      .catch(() => {
        if (!cancelled) setConfigLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const clientId = clientIds?.[platform.id] ?? ''
  const fields = PLATFORM_CREDENTIAL_FIELDS[platform.id] ?? []
  const oauthConfig = PLATFORM_OAUTH_CONFIG[platform.id]
  /** True while an OAuth flow is actively in progress (not idle or errored). */
  const isOAuthConnecting = oauthStep !== 'idle' && oauthStep !== 'error'
  /** Whether this platform resolves its auth URL server-side using the user's handle. */
  const isHandleInit = oauthConfig?.requiresHandleInit === true
  /** Server env-var prefix for this platform (Instagram/Facebook share Meta's). */
  const envPrefix = platform.id === 'instagram' || platform.id === 'facebook' ? 'META' : platform.id.toUpperCase()

  // ── Keyboard accessibility: close on Escape ──────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isOAuthConnecting) {
        onClose()
      }
    },
    [isOAuthConnecting, onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // ── OAuth flow (popup-based) ──────────────────────────────────────────────

  /**
   * Generate a PKCE (RFC 7636) code_verifier / code_challenge pair using the
   * Web Cryptography API.  Required by platforms such as Twitter/X that mandate
   * PKCE for public (non-confidential) OAuth 2.0 clients.
   */
  async function generatePKCEChallenge(): Promise<{ codeVerifier: string; codeChallenge: string }> {
    // 32 random bytes → 43-char Base64url verifier (within the 43-128 char range)
    const raw = new Uint8Array(32)
    crypto.getRandomValues(raw)
    const codeVerifier = btoa(String.fromCharCode(...raw))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
    const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    return { codeVerifier, codeChallenge }
  }

  /**
   * Bluesky-specific OAuth flow.
   *
   * Calls POST /api/bluesky/initiate to resolve the user's handle and
   * get back an authorization URL, then opens it as a popup.  The rest of
   * the flow (callback postMessage → code exchange) is identical to the
   * standard OAuth path via openOAuthPopup().
   */
  const handleBlueskyOAuth = async () => {
    const handle = blueskyHandle.trim()
    if (!handle) {
      setOauthStep('error')
      setOauthError('Please enter your Bluesky handle (e.g. you.bsky.social).')
      return
    }

    setOauthStep('resolving')
    setOauthError(null)

    const state = crypto.randomUUID()

    try {
      const res = await fetch('/api/bluesky/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ handle, state }),
      })
      const body = (await res.json().catch(() => ({}))) as { authorizationUrl?: string; error?: string }
      if (!res.ok) {
        setOauthStep('error')
        setOauthError(body.error ?? `Failed to initiate Bluesky connection (HTTP ${res.status}).`)
        return
      }
      if (!body.authorizationUrl) {
        setOauthStep('error')
        setOauthError('Server did not return an authorization URL.')
        return
      }
      openOAuthPopup(body.authorizationUrl, state)
    } catch (err) {
      setOauthStep('error')
      setOauthError(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Open an OAuth popup for the given URL, listen for the callback message,
   * and exchange the authorization code server-side.
   *
   * Shared by both the standard platform flow (handleOAuth) and the
   * Bluesky handle-resolution flow (handleBlueskyOAuth).
   */
  const openOAuthPopup = (url: string, state: string) => {
    setOauthStep('opening')

    setTimeout(() => {
      const popup = window.open(url, `oauth-${platform.id}`, 'width=600,height=700,scrollbars=yes,resizable=yes')

      if (!popup) {
        setOauthStep('error')
        setOauthError('Popup was blocked by your browser. Please allow popups for this site and try again.')
        return
      }

      setOauthStep('authorizing')

      let resolved = false

      const resolve = (success: boolean, errorMsg?: string) => {
        if (resolved) return
        resolved = true
        clearInterval(pollTimer)
        window.removeEventListener('message', onMessage)
        if (success) {
          setOauthStep('success')
          setTimeout(() => {
            onConnect(platform.id)
            onClose()
          }, 800)
        } else {
          setOauthStep('error')
          setOauthError(errorMsg ?? 'Authorization failed.')
        }
      }

      let finalizing = false
      const onMessage = async (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return
        if (e.data?.type !== 'oauth_callback') return
        if (resolved || finalizing) return
        if (e.data.state !== state) {
          resolve(false, 'Authorization failed: state parameter mismatch. Please try again.')
          return
        }
        if (e.data.error) {
          const safeError = String(e.data.error).substring(0, 200)
          resolve(false, `Authorization failed: ${safeError}`)
          return
        }
        if (!e.data.code) {
          resolve(false, 'Authorization failed: no authorization code was returned.')
          return
        }

        finalizing = true
        clearInterval(pollTimer)
        console.info(`[PlatformConnectionModal] OAuth code received for ${platform.id} — exchanging it on the server…`)

        try {
          const res = await fetch(
            `/api/oauth/callback?code=${encodeURIComponent(e.data.code)}&platform=${encodeURIComponent(platform.id)}&state=${encodeURIComponent(state)}`,
            { credentials: 'include' },
          )
          const body = (await res.json().catch(() => ({}))) as { error?: string; authorId?: string }
          if (!res.ok) {
            console.error(`[PlatformConnectionModal] Server rejected the ${platform.id} OAuth callback: HTTP ${res.status}`, body)
            resolve(false, body.error ?? `The server could not complete the connection (HTTP ${res.status}).`)
            return
          }

          if (platform.id === 'linkedin' && body.authorId) {
            localStorage.setItem(`linkedin_authorId_${userId}`, body.authorId)
            console.info('[PlatformConnectionModal] Stored LinkedIn author ID for publishing')
          }

          console.info(`[PlatformConnectionModal] ${platform.id} connected — token stored on the server`)
          resolve(true)
        } catch (err) {
          console.error(`[PlatformConnectionModal] Failed to reach the server to complete the ${platform.id} connection:`, err)
          resolve(false, 'Authorization succeeded, but the server could not be reached to store the connection. Please try again.')
        }
      }
      window.addEventListener('message', onMessage)

      const pollTimer = setInterval(() => {
        if (popup.closed) {
          resolve(false, 'Authorization was cancelled.')
        }
      }, 500)
    }, 100)
  }

  const handleOAuth = () => {
    if (!oauthConfig) {
      setOauthStep('error')
      setOauthError('OAuth is not configured for this platform.')
      return
    }

    // Bluesky uses a server-side handle resolution step instead of a fixed URL.
    if (isHandleInit) {
      void handleBlueskyOAuth()
      return
    }

    setOauthStep('opening')
    setOauthError(null)

    // Allow React to render the 'opening' state before the popup appears.
    // The popup window initiates the OAuth 2.0 authorization flow.  The
    // platform redirects back to /oauth/callback, which posts a message to
    // window.opener and closes itself.  We also poll as a fallback in case
    // the user closes the popup manually before completing auth.
    setTimeout(async () => {
      // Substitute URL placeholders with runtime values.
      // {CLIENT_ID}    — the registered OAuth 2.0 client ID for this app.
      // {REDIRECT_URI} — must exactly match the URI registered in the platform's
      //   developer dashboard (OAuth 2.0 §4.1.1).
      // {STATE}        — a cryptographically random token bound to this request;
      //   validated in onMessage below to prevent CSRF attacks (RFC 6749 §10.12).
      // {CODE_CHALLENGE} — PKCE S256 challenge (RFC 7636); only present in URLs
      //   that require PKCE (e.g. Twitter/X).
      const redirectUri = encodeURIComponent(`${window.location.origin}/oauth/callback`)
      const state = crypto.randomUUID()

      let url = oauthConfig.authUrl
        .replace('{CLIENT_ID}', encodeURIComponent(clientId))
        .replace('{REDIRECT_URI}', redirectUri)
        .replace('{STATE}', state)

      // Generate and inject the PKCE code_challenge for platforms that require it.
      // The matching code_verifier must be kept and sent to the server at token
      // exchange (RFC 7636 §4.5), so it is held in this closure for onMessage.
      let codeVerifier = ''
      if (url.includes('{CODE_CHALLENGE}')) {
        const pkce = await generatePKCEChallenge()
        codeVerifier = pkce.codeVerifier
        url = url.replace('{CODE_CHALLENGE}', pkce.codeChallenge)
      }

      const popup = window.open(
        url,
        `oauth-${platform.id}`,
        'width=600,height=700,scrollbars=yes,resizable=yes'
      )

      if (!popup) {
        setOauthStep('error')
        setOauthError(
          'Popup was blocked by your browser. Please allow popups for this site and try again.'
        )
        return
      }

      setOauthStep('authorizing')

      let resolved = false

      // Finalise the OAuth flow — idempotent so both the message listener
      // and the poll timer can call it without racing.
      const resolve = (success: boolean, errorMsg?: string) => {
        if (resolved) return
        resolved = true
        clearInterval(pollTimer)
        window.removeEventListener('message', onMessage)
        if (success) {
          setOauthStep('success')
          setTimeout(() => {
            onConnect(platform.id)
            onClose()
          }, 800)
        } else {
          setOauthStep('error')
          setOauthError(errorMsg ?? 'Authorization failed.')
        }
      }

      // Primary path: /oauth/callback posts a message to window.opener with the
      // authorization code (or an error) before closing the popup window.
      let finalizing = false
      const onMessage = async (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return
        if (e.data?.type !== 'oauth_callback') return
        if (resolved || finalizing) return
        // Validate state to reject forged/replayed callbacks (CSRF protection).
        if (e.data.state !== state) {
          resolve(false, 'Authorization failed: state parameter mismatch. Please try again.')
          return
        }
        if (e.data.error) {
          // Limit length to prevent log injection; React JSX escapes HTML automatically.
          const safeError = String(e.data.error).substring(0, 200)
          resolve(false, `Authorization failed: ${safeError}`)
          return
        }
        if (!e.data.code) {
          resolve(false, 'Authorization failed: no authorization code was returned.')
          return
        }

        // The popup completed authorization. Stop the popup-closed poll now so
        // the popup closing can't race the async server exchange below into a
        // false "cancelled" error.
        finalizing = true
        clearInterval(pollTimer)
        console.info(`[PlatformConnectionModal] OAuth code received for ${platform.id} — exchanging it on the server…`)

        // The connection only counts once the server has exchanged the code
        // and stored the token — report failure otherwise, so the UI never
        // shows "Connected" for a connection that doesn't exist server-side.
        try {
          // Forward the PKCE code_verifier when one was generated (Twitter/X);
          // the server needs it to complete the token exchange.
          const verifierParam = codeVerifier
            ? `&code_verifier=${encodeURIComponent(codeVerifier)}`
            : ''
          const res = await fetch(
            `/api/oauth/callback?code=${encodeURIComponent(e.data.code)}&platform=${encodeURIComponent(platform.id)}&state=${encodeURIComponent(state)}${verifierParam}`,
            { credentials: 'include' }
          )
          const body = (await res.json().catch(() => ({}))) as {
            error?: string
            authorId?: string
          }
          if (!res.ok) {
            console.error(
              `[PlatformConnectionModal] Server rejected the ${platform.id} OAuth callback: HTTP ${res.status}`,
              body
            )
            resolve(
              false,
              body.error ?? `The server could not complete the connection (HTTP ${res.status}).`
            )
            return
          }

          // LinkedIn returns the member URN needed as the publishing author ID.
          if (platform.id === 'linkedin' && body.authorId) {
            localStorage.setItem(`linkedin_authorId_${userId}`, body.authorId)
            console.info('[PlatformConnectionModal] Stored LinkedIn author ID for publishing')
          }

          console.info(`[PlatformConnectionModal] ${platform.id} connected — token stored on the server`)
          resolve(true)
        } catch (err) {
          console.error(
            `[PlatformConnectionModal] Failed to reach the server to complete the ${platform.id} connection:`,
            err
          )
          resolve(
            false,
            'Authorization succeeded, but the server could not be reached to store the connection. Please try again.'
          )
        }
      }
      window.addEventListener('message', onMessage)

      // Fallback: detect the popup being closed by the user without completing
      // auth (e.g. they dismissed the window).  A successful flow closes the
      // popup *after* posting a message, so `resolved` will already be true by
      // the time this fires — making the call a no-op.
      const pollTimer = setInterval(() => {
        if (popup.closed) {
          resolve(false, 'Authorization was cancelled.')
        }
      }, 500)
    }, 100)
  }

  // ── Credentials flow ──────────────────────────────────────────────────────

  const handleCredentialsSubmit = () => {
    // Presence check
    const missing = fields.find((f) => !credentials[f.key]?.trim())
    if (missing) {
      setCredError(`${missing.label} is required.`)
      return
    }
    // Platform-specific format validation
    for (const field of fields) {
      if (field.validate) {
        const err = field.validate(credentials[field.key] ?? '')
        if (err) {
          setCredError(err)
          return
        }
      }
    }
    setCredError(null)
    // Credentials are submitted securely via HTTPS to src/services/social/platforms/
    onConnect(platform.id)
    onClose()
  }

  const updateCredential = (key: string, value: string) => {
    setCredError(null)
    setCredentials((prev) => ({ ...prev, [key]: value }))
  }

  const toggleShow = (key: string) =>
    setShowPasswords((prev) => ({ ...prev, [key]: !prev[key] }))

  const displayName = oauthConfig?.shortName ?? platform.name

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    /* Backdrop */
    <div
      data-testid="platform-connection-modal"
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isOAuthConnecting) onClose()
      }}
    >
      {/* Modal panel */}
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <PlatformBadge platform={platform.id} size="lg" />
          <div className={styles.headerText}>
            <div className={styles.headerTitle}>Connect {platform.name}</div>
            <div className={styles.headerSubtitle}>{platform.description}</div>
          </div>
          {!isOAuthConnecting && (
            <button
              data-testid="modal-close-btn"
              className={styles.closeBtn}
              onClick={onClose}
            >
              ✕
            </button>
          )}
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Method switcher */}
          <div className={styles.methodSwitcher}>
            {(['oauth', 'credentials'] as ConnectionMethod[]).map((m) => (
              <button
                key={m}
                data-testid={`method-tab-${m}`}
                onClick={() => !isOAuthConnecting && setMethod(m)}
                className={[
                  styles.methodTab,
                  method === m ? styles.methodTabActive : styles.methodTabInactive,
                  isOAuthConnecting ? styles.methodTabDisabled : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {m === 'oauth' ? '🔑 OAuth (Recommended)' : '🔧 API Credentials'}
              </button>
            ))}
          </div>

          {/* ── OAuth panel ──────────────────────────────────────────────── */}
          {method === 'oauth' && (
            <div className={styles.oauthPanel}>
              {/* Loading state */}
              {configLoadState === 'loading' && (
                <div data-testid="oauth-loading" style={{ color: '#64748b', fontSize: '13px', padding: '12px 0' }}>
                  Loading configuration…
                </div>
              )}

              {/* Config fetch error */}
              {configLoadState === 'error' && (
                <div style={{ color: '#dc2626', fontSize: '13px', padding: '12px 0' }}>
                  Could not load platform configuration. Please refresh and try again.
                </div>
              )}

              {/* Ready — platform not supported (unknown id) */}
              {configLoadState === 'ready' && !oauthConfig && (
                <div data-testid="oauth-status" style={{ color: '#64748b', fontSize: '13px', padding: '12px 0' }}>
                  OAuth is not configured for this platform.
                </div>
              )}

              {/* Ready — platform supported but not configured on the server */}
              {configLoadState === 'ready' && oauthConfig && !clientId && (
                <NotConfiguredNotice platformName={displayName} envPrefix={envPrefix} />
              )}

              {/* Ready — fully configured: show the OAuth connect flow */}
              {configLoadState === 'ready' && oauthConfig && clientId && (
                <>
                  <p className={styles.oauthDescription}>
                    {isHandleInit
                      ? `Enter your ${displayName} handle to connect. You'll be redirected to authorise AutoMarketer — no password is shared.`
                      : `You'll be redirected to ${displayName} to authorise AutoMarketer. No password is shared with us — only the permissions you approve.`}
                  </p>

                  {oauthStep === 'idle' && (
                    <>
                      {/* Bluesky handle input */}
                      {isHandleInit && (
                        <div style={{ marginBottom: '12px' }}>
                          <label
                            htmlFor="bluesky-handle"
                            style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}
                          >
                            Your Bluesky Handle
                          </label>
                          <input
                            id="bluesky-handle"
                            data-testid="bluesky-handle-input"
                            type="text"
                            placeholder="you.bsky.social"
                            value={blueskyHandle}
                            onChange={(e) => setBlueskyHandle(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') void handleBlueskyOAuth() }}
                            style={{
                              width: '100%',
                              padding: '9px 12px',
                              borderRadius: '8px',
                              border: '1px solid #e2e8f0',
                              fontSize: '14px',
                              color: '#1e293b',
                              outline: 'none',
                              boxSizing: 'border-box',
                            }}
                            autoComplete="username"
                            autoFocus
                          />
                          <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                            You can use any Bluesky handle, e.g. alice.bsky.social or alice.example.com
                          </p>
                        </div>
                      )}
                      <button
                        data-testid="oauth-connect-btn"
                        onClick={handleOAuth}
                        style={{
                          width: '100%',
                          padding: '11px 20px',
                          borderRadius: '8px',
                          border: 'none',
                          background: platform.bgColor,
                          color: platform.color,
                          fontWeight: 700,
                          fontSize: '14px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                        }}
                      >
                        <PlatformBadge platform={platform.id} size="sm" />
                        {oauthConfig?.label ?? `Connect ${displayName}`}
                      </button>
                    </>
                  )}

                  {oauthStep === 'resolving' && (
                    <div data-testid="oauth-status" className={styles.oauthStatus}>
                      🔍 Resolving your Bluesky account…
                    </div>
                  )}

                  {(oauthStep === 'opening' || oauthStep === 'authorizing') && (
                    <div data-testid="oauth-status" className={styles.oauthStatus}>
                      {oauthStep === 'opening'
                        ? `↗ Opening ${displayName}…`
                        : '⏳ Waiting for authorisation…'}
                    </div>
                  )}

                  {oauthStep === 'success' && (
                    <div data-testid="oauth-status" className={styles.oauthStatusSuccess}>
                      ✓ Connected! Closing…
                    </div>
                  )}

                  {oauthStep === 'error' && (
                    <div>
                      <div data-testid="oauth-status" className={styles.oauthStatusError}>
                        ⚠ {oauthError}
                      </div>
                      <button
                        data-testid="oauth-retry-btn"
                        className={styles.oauthRetryBtn}
                        onClick={() => {
                          setOauthStep('idle')
                          setOauthError(null)
                        }}
                      >
                        Try again
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── API credentials panel ─────────────────────────────────────── */}
          {method === 'credentials' && (
            <div>
              <p className={styles.credentialsDescription}>
                Enter your {displayName} developer credentials. These are transmitted securely
                over HTTPS and never stored on AutoMarketer's servers.
              </p>

              <div className={styles.credentialsFields}>
                {fields.map((field) => (
                  <div key={field.key}>
                    <label className={styles.fieldLabel}>{field.label}</label>
                    <div className={styles.fieldWrapper}>
                      <input
                        data-testid={`credential-input-${field.key}`}
                        type={
                          field.type === 'password' && !showPasswords[field.key]
                            ? 'password'
                            : 'text'
                        }
                        className={[
                          styles.fieldInput,
                          field.type === 'password' ? styles.fieldInputWithToggle : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        placeholder={field.placeholder}
                        value={credentials[field.key] ?? ''}
                        onChange={(e) => updateCredential(field.key, e.target.value)}
                        autoComplete="off"
                      />
                      {field.type === 'password' && (
                        <button
                          className={styles.toggleVisibilityBtn}
                          onClick={() => toggleShow(field.key)}
                        >
                          {showPasswords[field.key] ? 'Hide' : 'Show'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.securityNote}>
                🔒 Credentials are transmitted securely over HTTPS and are never logged or stored
                by AutoMarketer's servers.
              </div>

              {credError && (
                <p data-testid="credentials-error" className={styles.credentialsError}>
                  {credError}
                </p>
              )}

              <button
                data-testid="credentials-connect-btn"
                className={styles.connectBtn}
                onClick={handleCredentialsSubmit}
              >
                Connect {platform.name}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default PlatformConnectionModal
