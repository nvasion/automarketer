import { useState, useEffect, useCallback } from 'react'
import type { PlatformConfig } from '../types'
import PlatformBadge from './PlatformBadge'
import { PLATFORM_CREDENTIAL_FIELDS, PLATFORM_OAUTH_CONFIG } from '../config/platformConfig'
import {
  fetchPlatformClientIds,
  savePlatformClientId,
} from '../services/platformConfigService'
import type { PlatformClientIds } from '../services/platformConfigService'
import styles from './PlatformConnectionModal.module.css'

// ── Types ────────────────────────────────────────────────────────────────────

type ConnectionMethod = 'oauth' | 'credentials'
/** 'opening' = popup window is being opened; 'authorizing' = waiting for user; 'error' = blocked/failed */
type OAuthStep = 'idle' | 'opening' | 'authorizing' | 'success' | 'error'
type ConfigLoadState = 'loading' | 'ready' | 'error'

interface Props {
  platform: PlatformConfig
  onClose: () => void
  onConnect: (platformId: string) => void
}

// ── Setup instructions + inline client-ID save ────────────────────────────────

interface SetupInstructionsProps {
  platformId: string
  platformName: string
  /** Called with the freshly saved client ID after a successful PUT. */
  onSaved: (clientId: string) => void
}

function SetupInstructions({ platformId, platformName, onSaved }: SetupInstructionsProps) {
  const config = PLATFORM_OAUTH_CONFIG[platformId]
  const redirectUri = `${window.location.origin}/oauth/callback`

  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!config) return null

  const { setupInstructions } = config

  const handleSave = async () => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Paste your Client ID before saving.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await savePlatformClientId(platformId, trimmed)
      onSaved(trimmed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save client ID.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="setup-instructions" style={{ textAlign: 'left' }}>
      <div
        style={{
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: '8px',
          padding: '12px 14px',
          marginBottom: '16px',
          fontSize: '13px',
          color: '#92400e',
          lineHeight: 1.5,
        }}
      >
        <strong>{platformName} is not configured yet.</strong> Create an OAuth app on the
        {' '}{setupInstructions.portalName} and paste the Client ID below — it's saved to your
        account, no environment variables or server restarts required.
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
          How to set up {platformName} OAuth:
        </div>
        <ol
          style={{
            margin: 0,
            paddingLeft: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          {setupInstructions.steps.map((step, i) => (
            <li key={i} style={{ fontSize: '13px', color: '#374151', lineHeight: 1.5 }}>
              {step.replace('{REDIRECT_URI}', redirectUri)}
            </li>
          ))}
          <li style={{ fontSize: '13px', color: '#374151', lineHeight: 1.5 }}>
            Paste the Client ID into the field below and click <strong>Save</strong>.
          </li>
        </ol>
      </div>

      <div
        style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '8px',
          padding: '10px 14px',
          fontSize: '12px',
          color: '#14532d',
          lineHeight: 1.5,
          marginBottom: '14px',
        }}
      >
        <strong>Redirect URI to register:</strong>{' '}
        <code
          data-testid="redirect-uri-display"
          style={{ background: '#dcfce7', padding: '2px 6px', borderRadius: '3px', wordBreak: 'break-all' }}
        >
          {redirectUri}
        </code>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <a
          href={setupInstructions.portalUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '13px',
            color: '#2563eb',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          Open {setupInstructions.portalName} ↗
        </a>
      </div>

      {/* Inline save form */}
      <div>
        <label className={styles.fieldLabel} htmlFor={`client-id-input-${platformId}`}>
          {platformName} Client ID
        </label>
        <input
          id={`client-id-input-${platformId}`}
          data-testid="client-id-input"
          className={styles.fieldInput}
          type="text"
          placeholder="Paste your OAuth Client ID"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError(null)
          }}
          autoComplete="off"
          disabled={saving}
        />
        {error && (
          <p
            data-testid="client-id-error"
            className={styles.credentialsError}
            style={{ marginTop: '10px', marginBottom: 0 }}
          >
            {error}
          </p>
        )}
        <button
          data-testid="save-client-id-btn"
          className={styles.connectBtn}
          style={{ marginTop: '12px' }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save Client ID'}
        </button>
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

function PlatformConnectionModal({ platform, onClose, onConnect }: Props) {
  const [method, setMethod] = useState<ConnectionMethod>('oauth')
  const [oauthStep, setOauthStep] = useState<OAuthStep>('idle')
  const [oauthError, setOauthError] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [credError, setCredError] = useState<string | null>(null)
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({})

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

  // Update local state after the user saves their client ID inline so the
  // OAuth connect button becomes available without a page refresh.
  const handleClientIdSaved = useCallback(
    (savedClientId: string) => {
      setClientIds((prev) => {
        // Facebook and Instagram share one Meta App ID — the server mirrors
        // the value automatically, so reflect that in the local cache too.
        const next: PlatformClientIds = {
          linkedin: '',
          twitter: '',
          reddit: '',
          facebook: '',
          instagram: '',
          ...(prev ?? {}),
        }
        next[platform.id] = savedClientId
        if (platform.id === 'facebook') next.instagram = savedClientId
        if (platform.id === 'instagram') next.facebook = savedClientId
        return next
      })
    },
    [platform.id]
  )

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

  const handleOAuth = () => {
    if (!oauthConfig) {
      setOauthStep('error')
      setOauthError('OAuth is not configured for this platform.')
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
      if (url.includes('{CODE_CHALLENGE}')) {
        const { codeChallenge } = await generatePKCEChallenge()
        url = url.replace('{CODE_CHALLENGE}', codeChallenge)
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
      const onMessage = (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return
        if (e.data?.type !== 'oauth_callback') return
        // Validate state to reject forged/replayed callbacks (CSRF protection).
        if (e.data.state !== state) {
          resolve(false, 'Authorization failed: state parameter mismatch. Please try again.')
          return
        }
        if (e.data.error) {
          // Limit length to prevent log injection; React JSX escapes HTML automatically.
          const safeError = String(e.data.error).substring(0, 200)
          resolve(false, `Authorization failed: ${safeError}`)
        } else {
          resolve(true)
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

              {/* Ready — platform supported but the user hasn't saved a client ID yet */}
              {configLoadState === 'ready' && oauthConfig && !clientId && (
                <SetupInstructions
                  platformId={platform.id}
                  platformName={displayName}
                  onSaved={handleClientIdSaved}
                />
              )}

              {/* Ready — fully configured: show the OAuth connect flow */}
              {configLoadState === 'ready' && oauthConfig && clientId && (
                <>
                  <p className={styles.oauthDescription}>
                    You'll be redirected to {displayName} to authorise AutoMarketer. No password is
                    shared with us — only the permissions you approve.
                  </p>

                  {oauthStep === 'idle' && (
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
