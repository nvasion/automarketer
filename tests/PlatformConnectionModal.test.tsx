import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import PlatformConnectionModal from '../src/components/PlatformConnectionModal'
import type { PlatformConfig } from '../src/types'

// ── Mock platform config — supply test client IDs so the OAuth guard doesn't
// fire and the existing popup-flow tests are unaffected by missing env vars.
vi.mock('../src/config/platformConfig', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/config/platformConfig')>()
  return {
    ...original,
    PLATFORM_OAUTH_CONFIG: {
      ...original.PLATFORM_OAUTH_CONFIG,
      linkedin: { ...original.PLATFORM_OAUTH_CONFIG.linkedin, clientId: 'test-linkedin-client-id' },
      twitter: { ...original.PLATFORM_OAUTH_CONFIG.twitter, clientId: 'test-twitter-client-id' },
      reddit: { ...original.PLATFORM_OAUTH_CONFIG.reddit, clientId: 'test-reddit-client-id' },
      facebook: { ...original.PLATFORM_OAUTH_CONFIG.facebook, clientId: 'test-facebook-app-id' },
      instagram: { ...original.PLATFORM_OAUTH_CONFIG.instagram, clientId: 'test-facebook-app-id' },
    },
  }
})

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

function renderModal(
  overrides: Partial<{ platform: PlatformConfig; onClose: () => void; onConnect: (id: string) => void }> = {}
) {
  const props = {
    platform: LINKEDIN,
    onClose: vi.fn(),
    onConnect: vi.fn(),
    ...overrides,
  }
  const result = render(<PlatformConnectionModal {...props} />)
  return { ...result, ...props }
}

// Known state value injected by the mock so tests can include it in postMessage events.
const MOCK_OAUTH_STATE = 'test-oauth-state-uuid'

describe('PlatformConnectionModal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockPopup.closed = false
    // Default: popup opens successfully
    vi.spyOn(window, 'open').mockReturnValue(mockPopup as unknown as Window)
    // Fix the random state so tests can assert on message contents
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(MOCK_OAUTH_STATE as ReturnType<typeof crypto.randomUUID>)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // ── Rendering ────────────────────────────────────────────────────────────

  it('renders with platform name in the header', () => {
    renderModal()
    expect(screen.getByText('Connect LinkedIn')).toBeDefined()
  })

  it('renders a close button', () => {
    renderModal()
    expect(screen.getByTestId('modal-close-btn')).toBeDefined()
  })

  it('calls onClose when the close button is clicked', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByTestId('modal-close-btn'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when clicking the backdrop', () => {
    const { onClose } = renderModal()
    const backdrop = screen.getByTestId('platform-connection-modal')
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when clicking inside the modal panel (not backdrop)', () => {
    const { onClose } = renderModal()
    const heading = screen.getByText('Connect LinkedIn')
    fireEvent.click(heading)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows OAuth tab as active by default', () => {
    renderModal()
    expect(screen.getByTestId('method-tab-oauth')).toBeDefined()
    expect(screen.getByTestId('oauth-connect-btn')).toBeDefined()
  })

  it('shows credentials tab when clicked', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('method-tab-credentials'))
    expect(screen.getByTestId('credentials-connect-btn')).toBeDefined()
  })

  // ── Keyboard accessibility ────────────────────────────────────────────────

  it('closes modal when Escape key is pressed', () => {
    const { onClose } = renderModal()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when Escape is pressed while OAuth is in progress', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    // oauthStep is 'opening' → isOAuthConnecting = true
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when Escape is pressed after an OAuth error (not in-progress)', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const { onClose } = renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) }) // fires setTimeout → popup null → 'error'
    // oauthStep is 'error' → isOAuthConnecting = false → Escape should close
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // ── OAuth flow ────────────────────────────────────────────────────────────

  it('OAuth button shows correct label for LinkedIn', () => {
    renderModal()
    expect(screen.getByTestId('oauth-connect-btn').textContent).toContain('Sign in with LinkedIn')
  })

  it('OAuth button for Twitter shows "Sign in with X" (consistent branding)', () => {
    renderModal({ platform: TWITTER })
    expect(screen.getByTestId('oauth-connect-btn').textContent).toContain('Sign in with X')
  })

  it('OAuth redirect description uses short platform name', () => {
    renderModal({ platform: TWITTER })
    // Should say "X" not "X (Twitter)"
    expect(screen.getByText(/You'll be redirected to X to authorise/).textContent).toContain(
      'You\'ll be redirected to X to authorise'
    )
  })

  it('OAuth flow: shows opening status immediately after click', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    // Before the 100ms setTimeout fires, state is 'opening'
    expect(screen.getByTestId('oauth-status').textContent).toContain('Opening')
  })

  it('OAuth flow: opens a popup window with the correct OAuth URL', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining('linkedin.com/oauth/v2/authorization'),
      'oauth-linkedin',
      expect.stringContaining('width=600')
    )
  })

  it('OAuth flow: substitutes {REDIRECT_URI} with the real /oauth/callback URL', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })
    const [calledUrl] = (window.open as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(calledUrl).toContain('redirect_uri=')
    expect(calledUrl).toContain(encodeURIComponent('/oauth/callback'))
    expect(calledUrl).not.toContain('{REDIRECT_URI}')
  })

  it('OAuth flow: substitutes {CLIENT_ID} with the platform client ID', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })
    const [calledUrl] = (window.open as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(calledUrl).toContain('client_id=test-linkedin-client-id')
    expect(calledUrl).not.toContain('{CLIENT_ID}')
  })

  it('OAuth flow: shows error when the platform has no OAuth config entry', () => {
    // A platform with an id not present in PLATFORM_OAUTH_CONFIG triggers the
    // "not configured" guard before any popup is opened.
    const UNKNOWN: PlatformConfig = {
      id: 'tiktok',
      name: 'TikTok',
      icon: 'TT',
      color: '#ffffff',
      bgColor: '#000000',
      charLimit: 2200,
      description: 'Short-form video platform',
    }
    renderModal({ platform: UNKNOWN })
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    // The guard fires synchronously — no setTimeout needed
    expect(screen.getByTestId('oauth-status').textContent).toContain('not configured')
    expect(window.open).not.toHaveBeenCalled()
  })

  it('OAuth flow: completes successfully when the callback postMessage is received', () => {
    // renderModal() uses the LINKEDIN platform by default (see renderModal helper above)
    const { onConnect, onClose } = renderModal()
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
    expect(screen.getByTestId('oauth-status').textContent).toContain('Connected')

    act(() => { vi.advanceTimersByTime(800) })
    expect(onConnect).toHaveBeenCalledWith('linkedin')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('OAuth flow: shows error when the callback postMessage contains an error', () => {
    renderModal()
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

  it('OAuth flow: ignores postMessage events from other origins', () => {
    renderModal()
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

  it('OAuth flow: shows error when postMessage state does not match (CSRF)', () => {
    renderModal()
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

  it('OAuth flow: shows authorizing status once popup opens', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.getByTestId('oauth-status').textContent).toContain('authorisation')
  })

  it('OAuth flow: shows cancellation error when user manually closes the popup', () => {
    // Manually closing the popup means the user abandoned the flow — it is NOT
    // a success.  Success only comes via the postMessage from /oauth/callback.
    const { onConnect, onClose } = renderModal()
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

  it('OAuth flow: popup closed after postMessage does not double-resolve (success wins)', () => {
    // When the callback page posts a success message AND then closes the popup,
    // the poll timer fires after `resolved = true` and must be a no-op.
    const { onConnect } = renderModal()
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
    expect(screen.getByTestId('oauth-status').textContent).toContain('Connected')

    // Popup then closes — the poll timer should not override the success state
    mockPopup.closed = true
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByTestId('oauth-status').textContent).toContain('Connected')

    act(() => { vi.advanceTimersByTime(800) })
    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  it('OAuth flow: shows error when popup is blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.getByTestId('oauth-status').textContent).toContain('blocked')
    expect(screen.getByTestId('oauth-retry-btn')).toBeDefined()
  })

  it('OAuth flow: retry button resets to idle state', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })
    // In error state — click retry
    fireEvent.click(screen.getByTestId('oauth-retry-btn'))
    // Should show the connect button again (idle state)
    expect(screen.getByTestId('oauth-connect-btn')).toBeDefined()
    expect(screen.queryByTestId('oauth-retry-btn')).toBeNull()
  })

  it('close button is hidden while OAuth flow is in progress', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    // oauthStep = 'opening' → isOAuthConnecting = true
    expect(screen.queryByTestId('modal-close-btn')).toBeNull()
  })

  it('close button reappears after OAuth error', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })
    // oauthStep = 'error' → isOAuthConnecting = false
    expect(screen.getByTestId('modal-close-btn')).toBeDefined()
  })

  it('backdrop click is disabled during active OAuth flow', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    const backdrop = screen.getByTestId('platform-connection-modal')
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
  })

  // ── Credentials flow ──────────────────────────────────────────────────────

  it('renders a credential field for LinkedIn (accessToken)', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('method-tab-credentials'))
    expect(screen.getByTestId('credential-input-accessToken')).toBeDefined()
  })

  it('renders all four credential fields for Twitter', () => {
    renderModal({ platform: TWITTER })
    fireEvent.click(screen.getByTestId('method-tab-credentials'))
    expect(screen.getByTestId('credential-input-apiKey')).toBeDefined()
    expect(screen.getByTestId('credential-input-apiSecret')).toBeDefined()
    expect(screen.getByTestId('credential-input-accessToken')).toBeDefined()
    expect(screen.getByTestId('credential-input-accessTokenSecret')).toBeDefined()
  })

  it('shows validation error when submitting empty credentials', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('method-tab-credentials'))
    fireEvent.click(screen.getByTestId('credentials-connect-btn'))
    expect(screen.getByTestId('credentials-error')).toBeDefined()
    expect(screen.getByTestId('credentials-error').textContent).toContain('required')
  })

  it('shows format validation error for a token that is too short', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('method-tab-credentials'))
    fireEvent.change(screen.getByTestId('credential-input-accessToken'), {
      target: { value: 'short' }, // < 20 chars → fails validation
    })
    fireEvent.click(screen.getByTestId('credentials-connect-btn'))
    expect(screen.getByTestId('credentials-error').textContent).toContain('too short')
  })

  it('calls onConnect + onClose when credentials pass validation', () => {
    const { onConnect, onClose } = renderModal()
    fireEvent.click(screen.getByTestId('method-tab-credentials'))
    fireEvent.change(screen.getByTestId('credential-input-accessToken'), {
      target: { value: 'AQXaValidLongEnoughToken123' }, // 26 chars → passes validation
    })
    fireEvent.click(screen.getByTestId('credentials-connect-btn'))
    expect(onConnect).toHaveBeenCalledWith('linkedin')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clears the error when the user starts typing', () => {
    renderModal()
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

  it('shows a security note in the credentials panel', () => {
    renderModal()
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

function renderSettings() {
  return render(
    <HashRouter>
      <AuthContext.Provider value={mockAuthContext}>
        <Settings />
      </AuthContext.Provider>
    </HashRouter>
  )
}

describe('Settings – Connected Platforms tab', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as unknown as Window)
    // Fix the random state so tests can include it in postMessage events
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(MOCK_OAUTH_STATE as ReturnType<typeof crypto.randomUUID>)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('navigates to the Platforms tab', () => {
    renderSettings()
    fireEvent.click(screen.getByText('Connected Platforms'))
    expect(screen.getByText('Connect your social accounts to publish directly from AutoMarketer.')).toBeDefined()
  })

  it('Connect button opens the connection modal for that platform', () => {
    renderSettings()
    fireEvent.click(screen.getByText('Connected Platforms'))
    // Reddit is not connected by default — click its Connect button
    fireEvent.click(screen.getByTestId('platform-btn-reddit'))
    expect(screen.getByTestId('platform-connection-modal')).toBeDefined()
    expect(screen.getByText('Connect Reddit')).toBeDefined()
  })

  it('modal shows correct platform (Facebook when Facebook Connect is clicked)', () => {
    renderSettings()
    fireEvent.click(screen.getByText('Connected Platforms'))
    fireEvent.click(screen.getByTestId('platform-btn-facebook'))
    expect(screen.getByText('Connect Facebook')).toBeDefined()
  })

  it('closing the modal does not mark platform as connected', () => {
    renderSettings()
    fireEvent.click(screen.getByText('Connected Platforms'))
    fireEvent.click(screen.getByTestId('platform-btn-reddit'))
    fireEvent.click(screen.getByTestId('modal-close-btn'))
    // Modal is gone
    expect(screen.queryByTestId('platform-connection-modal')).toBeNull()
    // Reddit button should still say Connect (not Disconnect)
    expect(screen.getByTestId('platform-btn-reddit').textContent).toBe('Connect')
  })

  it('Disconnect button immediately disconnects without opening modal', () => {
    renderSettings()
    fireEvent.click(screen.getByText('Connected Platforms'))

    // First connect LinkedIn via the real OAuth success path (postMessage from /oauth/callback)
    fireEvent.click(screen.getByTestId('platform-btn-linkedin'))
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
