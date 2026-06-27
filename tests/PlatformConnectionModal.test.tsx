import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import PlatformConnectionModal from '../src/components/PlatformConnectionModal'
import type { PlatformConfig } from '../src/types'

// ── Mock the platform config service so tests never hit the network.
// fetchPlatformClientIds returns the server's configured (shared-app) client
// IDs. By default every platform is configured; individual tests override with
// mockResolvedValueOnce to simulate an unconfigured platform.
vi.mock('../src/services/platformConfigService', () => ({
  fetchPlatformClientIds: vi.fn().mockResolvedValue({
    linkedin: 'test-linkedin-client-id',
    twitter: 'test-twitter-client-id',
    reddit: 'test-reddit-client-id',
    facebook: 'test-facebook-app-id',
    instagram: 'test-facebook-app-id',
  }),
  // The Settings page fetches connection status on mount and disconnects
  // platforms on demand. Default to "nothing connected" so tests start clean;
  // individual flows drive connection via the OAuth postMessage path.
  fetchConnectedPlatforms: vi.fn().mockResolvedValue({}),
  disconnectPlatform: vi.fn().mockResolvedValue(undefined),
}))

import {
  fetchPlatformClientIds,
  fetchConnectedPlatforms,
  disconnectPlatform,
} from '../src/services/platformConfigService'
const mockFetchClientIds = fetchPlatformClientIds as ReturnType<typeof vi.fn>
const mockFetchConnected = fetchConnectedPlatforms as ReturnType<typeof vi.fn>
const mockDisconnect = disconnectPlatform as ReturnType<typeof vi.fn>

const LINKEDIN: PlatformConfig = {
  id: 'linkedin',
  name: 'LinkedIn',
  icon: 'in',
  color: '#ffffff',
  bgColor: '#0077B5',
  charLimit: 3000,
  description: 'Professional network — great for B2B content',
}

const TWITTER: PlatformConfig = {
  id: 'twitter',
  name: 'X (Twitter)',
  icon: '𝕏',
  color: '#ffffff',
  bgColor: '#000000',
  charLimit: 280,
  description: 'Fast-moving conversations and trending topics',
}

// Shared mock popup — reset in beforeEach
const mockPopup = { closed: false }

/**
 * Render the modal and wait for the async platform-config fetch to complete
 * before returning.  All tests should use this helper so they start with the
 * modal fully initialised (configLoadState === 'ready').
 */
async function renderModal(
  overrides: Partial<{ platform: PlatformConfig; onClose: () => void; onConnect: (id: string) => void }> = {}
) {
  const props = {
    platform: LINKEDIN,
    onClose: vi.fn(),
    onConnect: vi.fn(),
    ...overrides,
  }
  render(<PlatformConnectionModal {...props} />)
  // Flush the fetchPlatformClientIds() Promise so the modal reaches 'ready' state.
  await act(async () => {})
  return props
}

// Known state value injected by the mock so tests can include it in postMessage events.
const MOCK_OAUTH_STATE = 'test-oauth-state-uuid'

/**
 * Stub the global fetch used by the modal to notify /api/oauth/callback.
 * Defaults to a successful response that includes a LinkedIn author ID.
 */
function stubOAuthCallbackFetch(
  response: { ok: boolean; status?: number; body?: Record<string, unknown> } = {
    ok: true,
    body: { success: true, platform: 'linkedin', authorId: 'urn:li:person:test123' },
  }
) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: () => Promise.resolve(response.body ?? {}),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('PlatformConnectionModal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    mockPopup.closed = false
    // Default: popup opens successfully
    vi.spyOn(window, 'open').mockReturnValue(mockPopup as unknown as Window)
    // Fix the random state so tests can assert on message contents
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(MOCK_OAUTH_STATE as ReturnType<typeof crypto.randomUUID>)
    // The modal confirms the OAuth callback with the server before reporting
    // success — default to a server that accepts it.
    stubOAuthCallbackFetch()
    // Reset the mock to the default fully-configured response
    mockFetchClientIds.mockResolvedValue({
      linkedin: 'test-linkedin-client-id',
      twitter: 'test-twitter-client-id',
      reddit: 'test-reddit-client-id',
      facebook: 'test-facebook-app-id',
      instagram: 'test-facebook-app-id',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // ── Rendering ────────────────────────────────────────────────────────────

  it('renders with platform name in the header', async () => {
    await renderModal()
    expect(screen.getByText('Connect LinkedIn')).toBeDefined()
  })

  it('renders a close button', async () => {
    await renderModal()
    expect(screen.getByTestId('modal-close-btn')).toBeDefined()
  })

  it('calls onClose when the close button is clicked', async () => {
    const { onClose } = await renderModal()
    fireEvent.click(screen.getByTestId('modal-close-btn'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when clicking the backdrop', async () => {
    const { onClose } = await renderModal()
    const backdrop = screen.getByTestId('platform-connection-modal')
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when clicking inside the modal panel (not backdrop)', async () => {
    const { onClose } = await renderModal()
    const heading = screen.getByText('Connect LinkedIn')
    fireEvent.click(heading)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows OAuth tab as active by default', async () => {
    await renderModal()
    expect(screen.getByTestId('method-tab-oauth')).toBeDefined()
    expect(screen.getByTestId('oauth-connect-btn')).toBeDefined()
  })

  it('shows credentials tab when clicked', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('method-tab-credentials'))
    expect(screen.getByTestId('credentials-connect-btn')).toBeDefined()
  })

  // ── Loading state ────────────────────────────────────────────────────────

  it('shows a loading indicator while fetching the platform config', () => {
    // Do NOT flush the Promise — modal should be in loading state
    render(<PlatformConnectionModal platform={LINKEDIN} onClose={vi.fn()} onConnect={vi.fn()} />)
    expect(screen.getByTestId('oauth-loading')).toBeDefined()
  })

  it('shows the "not configured" notice when the platform has no server client ID', async () => {
    mockFetchClientIds.mockResolvedValueOnce({
      linkedin: '', // not configured on the server
      twitter: '',
      reddit: '',
      facebook: '',
      instagram: '',
    })
    await renderModal()
    expect(screen.getByTestId('platform-not-configured')).toBeDefined()
    expect(screen.queryByTestId('oauth-connect-btn')).toBeNull()
  })

  it('"not configured" notice names the required server env vars', async () => {
    mockFetchClientIds.mockResolvedValueOnce({ linkedin: '', twitter: '', reddit: '', facebook: '', instagram: '' })
    await renderModal()
    const notice = screen.getByTestId('platform-not-configured')
    expect(notice.textContent).toContain('LINKEDIN_CLIENT_ID')
    expect(notice.textContent).toContain('LINKEDIN_CLIENT_SECRET')
  })

  it('uses FACEBOOK_* env-var names for Instagram (shared Meta app)', async () => {
    const INSTAGRAM: PlatformConfig = {
      id: 'instagram',
      name: 'Instagram',
      icon: 'IG',
      color: '#ffffff',
      bgColor: '#E4405F',
      charLimit: 2200,
      description: 'Visual storytelling',
    }
    mockFetchClientIds.mockResolvedValueOnce({ linkedin: '', twitter: '', reddit: '', facebook: '', instagram: '' })
    await renderModal({ platform: INSTAGRAM })
    expect(screen.getByTestId('platform-not-configured').textContent).toContain('META_CLIENT_ID')
  })

  it('shows the OAuth connect button when the server has the client ID configured', async () => {
    await renderModal()
    expect(screen.getByTestId('oauth-connect-btn')).toBeDefined()
    expect(screen.queryByTestId('platform-not-configured')).toBeNull()
  })

  // ── Keyboard accessibility ────────────────────────────────────────────────

  it('closes modal when Escape key is pressed', async () => {
    const { onClose } = await renderModal()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when Escape is pressed while OAuth is in progress', async () => {
    const { onClose } = await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    // oauthStep is 'opening' → isOAuthConnecting = true
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when Escape is pressed after an OAuth error (not in-progress)', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const { onClose } = await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) }) // fires setTimeout → popup null → 'error'
    // oauthStep is 'error' → isOAuthConnecting = false → Escape should close
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // ── OAuth flow ────────────────────────────────────────────────────────────

  it('OAuth button shows correct label for LinkedIn', async () => {
    await renderModal()
    expect(screen.getByTestId('oauth-connect-btn').textContent).toContain('Sign in with LinkedIn')
  })

  it('OAuth button for Twitter shows "Sign in with X" (consistent branding)', async () => {
    await renderModal({ platform: TWITTER })
    expect(screen.getByTestId('oauth-connect-btn').textContent).toContain('Sign in with X')
  })

  it('OAuth redirect description uses short platform name', async () => {
    await renderModal({ platform: TWITTER })
    // Should say "X" not "X (Twitter)"
    expect(screen.getByText(/You'll be redirected to X to authorise/).textContent).toContain(
      'You\'ll be redirected to X to authorise'
    )
  })

  it('OAuth flow: shows opening status immediately after click', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    // Before the 100ms setTimeout fires, state is 'opening'
    expect(screen.getByTestId('oauth-status').textContent).toContain('Opening')
  })

  it('OAuth flow: opens a popup window with the correct OAuth URL', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining('linkedin.com/oauth/v2/authorization'),
      'oauth-linkedin',
      expect.stringContaining('width=600')
    )
  })

  it('OAuth flow: substitutes {REDIRECT_URI} with the real /oauth/callback URL', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })
    const [calledUrl] = (window.open as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(calledUrl).toContain('redirect_uri=')
    expect(calledUrl).toContain(encodeURIComponent('/oauth/callback'))
    expect(calledUrl).not.toContain('{REDIRECT_URI}')
  })

  it('OAuth flow: substitutes {CLIENT_ID} with the platform client ID from the server', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })
    const [calledUrl] = (window.open as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(calledUrl).toContain('client_id=test-linkedin-client-id')
    expect(calledUrl).not.toContain('{CLIENT_ID}')
  })

  it('OAuth flow: shows error when the platform has no OAuth config entry', async () => {
    // A platform with an id not present in PLATFORM_OAUTH_CONFIG gets the
    // "not configured" message in the OAuth panel — no connect button appears.
    const UNKNOWN: PlatformConfig = {
      id: 'tiktok',
      name: 'TikTok',
      icon: 'TT',
      color: '#ffffff',
      bgColor: '#000000',
      charLimit: 2200,
      description: 'Short-form video platform',
    }
    await renderModal({ platform: UNKNOWN })
    expect(screen.getByTestId('oauth-status').textContent).toContain('not configured')
    expect(screen.queryByTestId('oauth-connect-btn')).toBeNull()
    expect(window.open).not.toHaveBeenCalled()
  })

  it('OAuth flow: completes successfully when the callback postMessage is received', async () => {
    // renderModal() uses the LINKEDIN platform by default (see renderModal helper above)
    const { onConnect, onClose } = await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) }) // open popup

    // Simulate /oauth/callback posting a success message (with matching state)
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'oauth_callback', code: 'test-auth-code', state: MOCK_OAUTH_STATE },
          origin: window.location.origin,
        })
      )
    })
    // Flush the async server confirmation (fetch to /api/oauth/callback)
    await act(async () => {})
    expect(screen.getByTestId('oauth-status').textContent).toContain('Connected')

    act(() => { vi.advanceTimersByTime(800) })
    expect(onConnect).toHaveBeenCalledWith('linkedin')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('OAuth flow: stores the LinkedIn author ID returned by the server', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'oauth_callback', code: 'test-auth-code', state: MOCK_OAUTH_STATE },
          origin: window.location.origin,
        })
      )
    })
    await act(async () => {})

    // Rendered without an AuthProvider, so the user id falls back to 'default'
    expect(localStorage.getItem('linkedin_authorId_default')).toBe('urn:li:person:test123')
  })

  it('OAuth flow: shows error when the server rejects the OAuth callback', async () => {
    stubOAuthCallbackFetch({
      ok: false,
      status: 502,
      body: { error: 'LinkedIn rejected the token exchange. See server logs for details.', code: 'TOKEN_EXCHANGE_FAILED' },
    })
    const { onConnect } = await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'oauth_callback', code: 'test-auth-code', state: MOCK_OAUTH_STATE },
          origin: window.location.origin,
        })
      )
    })
    await act(async () => {})

    expect(screen.getByTestId('oauth-status').textContent).toContain('token exchange')
    expect(screen.getByTestId('oauth-retry-btn')).toBeDefined()
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('OAuth flow: shows error when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { onConnect } = await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'oauth_callback', code: 'test-auth-code', state: MOCK_OAUTH_STATE },
          origin: window.location.origin,
        })
      )
    })
    await act(async () => {})

    expect(screen.getByTestId('oauth-status').textContent).toContain('server could not be reached')
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('OAuth flow: shows error when the callback postMessage contains an error', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) }) // open popup

    // Simulate the user denying access (include matching state for CSRF check)
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'oauth_callback', error: 'access_denied', state: MOCK_OAUTH_STATE },
          origin: window.location.origin,
        })
      )
    })
    expect(screen.getByTestId('oauth-status').textContent).toContain('Authorization failed')
    expect(screen.getByTestId('oauth-retry-btn')).toBeDefined()
  })

  it('OAuth flow: ignores postMessage events from other origins', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })

    // Message from a foreign origin must be silently ignored — flow stays in 'authorizing'
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'oauth_callback', code: 'stolen-code', state: MOCK_OAUTH_STATE },
          origin: 'https://evil.example.com',
        })
      )
    })
    expect(screen.getByTestId('oauth-status').textContent).toContain('authorisation')
  })

  it('OAuth flow: shows error when postMessage state does not match (CSRF)', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })

    // Message with wrong state must be rejected to prevent CSRF
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'oauth_callback', code: 'injected-code', state: 'attacker-state' },
          origin: window.location.origin,
        })
      )
    })
    expect(screen.getByTestId('oauth-status').textContent).toContain('state parameter mismatch')
    expect(screen.getByTestId('oauth-retry-btn')).toBeDefined()
  })

  it('OAuth flow: shows authorizing status once popup opens', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.getByTestId('oauth-status').textContent).toContain('authorisation')
  })

  it('OAuth flow: shows cancellation error when user manually closes the popup', async () => {
    // Manually closing the popup means the user abandoned the flow — it is NOT
    // a success.  Success only comes via the postMessage from /oauth/callback.
    const { onConnect, onClose } = await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) }) // open popup

    mockPopup.closed = true
    act(() => { vi.advanceTimersByTime(500) }) // one poll interval detects closed popup

    // Should show a cancellation error, not the success state
    expect(screen.getByTestId('oauth-status').textContent).toContain('cancelled')
    expect(screen.getByTestId('oauth-retry-btn')).toBeDefined()
    expect(onConnect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('OAuth flow: popup closed after postMessage does not double-resolve (success wins)', async () => {
    // When the callback page posts a success message AND then closes the popup,
    // the poll timer fires after `resolved = true` and must be a no-op.
    const { onConnect } = await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) }) // open popup

    // Success message arrives first
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'oauth_callback', code: 'auth-code', state: MOCK_OAUTH_STATE },
          origin: window.location.origin,
        })
      )
    })
    await act(async () => {}) // flush the async server confirmation
    expect(screen.getByTestId('oauth-status').textContent).toContain('Connected')

    // Popup then closes — the poll timer should not override the success state
    mockPopup.closed = true
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByTestId('oauth-status').textContent).toContain('Connected')

    act(() => { vi.advanceTimersByTime(800) })
    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  it('OAuth flow: shows error when popup is blocked', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.getByTestId('oauth-status').textContent).toContain('blocked')
    expect(screen.getByTestId('oauth-retry-btn')).toBeDefined()
  })

  it('OAuth flow: retry button resets to idle state', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })
    // In error state — click retry
    fireEvent.click(screen.getByTestId('oauth-retry-btn'))
    // Should show the connect button again (idle state)
    expect(screen.getByTestId('oauth-connect-btn')).toBeDefined()
    expect(screen.queryByTestId('oauth-retry-btn')).toBeNull()
  })

  it('close button is hidden while OAuth flow is in progress', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    // oauthStep = 'opening' → isOAuthConnecting = true
    expect(screen.queryByTestId('modal-close-btn')).toBeNull()
  })

  it('close button reappears after OAuth error', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })
    // oauthStep = 'error' → isOAuthConnecting = false
    expect(screen.getByTestId('modal-close-btn')).toBeDefined()
  })

  it('backdrop click is disabled during active OAuth flow', async () => {
    const { onClose } = await renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    const backdrop = screen.getByTestId('platform-connection-modal')
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
  })

  // ── Credentials flow ──────────────────────────────────────────────────────

  it('renders a credential field for LinkedIn (accessToken)', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('method-tab-credentials'))
    expect(screen.getByTestId('credential-input-accessToken')).toBeDefined()
  })

  it('renders all four credential fields for Twitter', async () => {
    await renderModal({ platform: TWITTER })
    fireEvent.click(screen.getByTestId('method-tab-credentials'))
    expect(screen.getByTestId('credential-input-apiKey')).toBeDefined()
    expect(screen.getByTestId('credential-input-apiSecret')).toBeDefined()
    expect(screen.getByTestId('credential-input-accessToken')).toBeDefined()
    expect(screen.getByTestId('credential-input-accessTokenSecret')).toBeDefined()
  })

  it('shows validation error when submitting empty credentials', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('method-tab-credentials'))
    fireEvent.click(screen.getByTestId('credentials-connect-btn'))
    expect(screen.getByTestId('credentials-error')).toBeDefined()
    expect(screen.getByTestId('credentials-error').textContent).toContain('required')
  })

  it('shows format validation error for a token that is too short', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('method-tab-credentials'))
    fireEvent.change(screen.getByTestId('credential-input-accessToken'), {
      target: { value: 'short' }, // < 20 chars → fails validation
    })
    fireEvent.click(screen.getByTestId('credentials-connect-btn'))
    expect(screen.getByTestId('credentials-error').textContent).toContain('too short')
  })

  it('calls onConnect + onClose when credentials pass validation', async () => {
    const { onConnect, onClose } = await renderModal()
    fireEvent.click(screen.getByTestId('method-tab-credentials'))
    fireEvent.change(screen.getByTestId('credential-input-accessToken'), {
      target: { value: 'AQXaValidLongEnoughToken123' }, // 26 chars → passes validation
    })
    fireEvent.click(screen.getByTestId('credentials-connect-btn'))
    expect(onConnect).toHaveBeenCalledWith('linkedin')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clears the error when the user starts typing', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('method-tab-credentials'))
    // Trigger required-field error
    fireEvent.click(screen.getByTestId('credentials-connect-btn'))
    expect(screen.getByTestId('credentials-error')).toBeDefined()
    // Start typing
    fireEvent.change(screen.getByTestId('credential-input-accessToken'), {
      target: { value: 'a' },
    })
    expect(screen.queryByTestId('credentials-error')).toBeNull()
  })

  it('shows a security note in the credentials panel', async () => {
    await renderModal()
    fireEvent.click(screen.getByTestId('method-tab-credentials'))
    // Use text unique to the security note box (not the description paragraph)
    expect(screen.getByText(/never logged or stored/i)).toBeDefined()
  })
})

// ── Settings integration: modal opens on Connect click ───────────────────────

import { HashRouter } from 'react-router-dom'
import { AuthContext } from '../src/contexts/AuthContext'
import Settings from '../src/pages/Settings'
import type { PublicUser } from '../src/services/authService'

const mockUser: PublicUser = {
  id: 'test-id',
  email: 'test.user@example.com',
  createdAt: new Date().toISOString(),
}

const mockAuthContext = {
  user: mockUser,
  loading: false,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}

async function renderSettings() {
  render(
    <HashRouter>
      <AuthContext.Provider value={mockAuthContext}>
        <Settings />
      </AuthContext.Provider>
    </HashRouter>
  )
  // Flush any pending Promises (platform-config fetch inside the modal fires
  // only after the modal is opened, so this just settles the initial render).
  await act(async () => {})
}

describe('Settings – Connected Platforms tab', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as unknown as Window)
    // Fix the random state so tests can include it in postMessage events
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(MOCK_OAUTH_STATE as ReturnType<typeof crypto.randomUUID>)
    // The modal confirms the OAuth callback with the server before success
    stubOAuthCallbackFetch()
    mockFetchClientIds.mockResolvedValue({
      linkedin: 'test-linkedin-client-id',
      twitter: 'test-twitter-client-id',
      reddit: 'test-reddit-client-id',
      facebook: 'test-facebook-app-id',
      instagram: 'test-facebook-app-id',
    })
    // restoreAllMocks() in the sibling suite's afterEach wipes these mock
    // implementations, so re-establish them here: the Settings page fetches
    // connection status on mount and disconnects on demand. Default to nothing
    // connected; disconnect resolves cleanly.
    mockFetchConnected.mockResolvedValue({})
    mockDisconnect.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('navigates to the Platforms tab', async () => {
    await renderSettings()
    fireEvent.click(screen.getByText('Connected Platforms'))
    expect(screen.getByText('Connect your social accounts to publish directly from AutoMarketer.')).toBeDefined()
  })

  it('Connect button opens the connection modal for that platform', async () => {
    await renderSettings()
    fireEvent.click(screen.getByText('Connected Platforms'))
    // Reddit is not connected by default — click its Connect button
    fireEvent.click(screen.getByTestId('platform-btn-reddit'))
    // Wait for the modal's async fetch to complete
    await act(async () => {})
    expect(screen.getByTestId('platform-connection-modal')).toBeDefined()
    expect(screen.getByText('Connect Reddit')).toBeDefined()
  })

  it('modal shows correct platform (Facebook when Facebook Connect is clicked)', async () => {
    await renderSettings()
    fireEvent.click(screen.getByText('Connected Platforms'))
    fireEvent.click(screen.getByTestId('platform-btn-facebook'))
    await act(async () => {})
    expect(screen.getByText('Connect Facebook')).toBeDefined()
  })

  it('closing the modal does not mark platform as connected', async () => {
    await renderSettings()
    fireEvent.click(screen.getByText('Connected Platforms'))
    fireEvent.click(screen.getByTestId('platform-btn-reddit'))
    await act(async () => {})
    fireEvent.click(screen.getByTestId('modal-close-btn'))
    // Modal is gone
    expect(screen.queryByTestId('platform-connection-modal')).toBeNull()
    // Reddit button should still say Connect (not Disconnect)
    expect(screen.getByTestId('platform-btn-reddit').textContent).toBe('Connect')
  })

  it('Disconnect button immediately disconnects without opening modal', async () => {
    await renderSettings()
    fireEvent.click(screen.getByText('Connected Platforms'))

    // First connect LinkedIn via the real OAuth success path (postMessage from /oauth/callback)
    fireEvent.click(screen.getByTestId('platform-btn-linkedin'))
    // Wait for the modal's async fetch to complete
    await act(async () => {})

    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) }) // open popup

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'oauth_callback', code: 'auth-code', state: MOCK_OAUTH_STATE },
          origin: window.location.origin,
        })
      )
    })
    await act(async () => {}) // flush the async server confirmation
    act(() => { vi.advanceTimersByTime(800) }) // success delay → onConnect fires, modal closes

    // Now LinkedIn shows Disconnect
    expect(screen.getByTestId('platform-btn-linkedin').textContent).toBe('Disconnect')
    fireEvent.click(screen.getByTestId('platform-btn-linkedin'))
    // No modal opened for a disconnect action
    expect(screen.queryByTestId('platform-connection-modal')).toBeNull()
    // Button reverts to Connect
    expect(screen.getByTestId('platform-btn-linkedin').textContent).toBe('Connect')
  })
})

// ── waitFor import for type correctness ──────────────────────────────────────
// (waitFor is imported above in the RTL import but referenced here to satisfy
//  TypeScript's strict unused-import checking in some configurations.)
void waitFor
