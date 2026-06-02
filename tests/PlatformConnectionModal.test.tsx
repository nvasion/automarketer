import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import PlatformConnectionModal from '../src/components/PlatformConnectionModal'
import type { PlatformConfig } from '../src/types'

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

describe('PlatformConnectionModal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockPopup.closed = false
    // Default: popup opens successfully
    vi.spyOn(window, 'open').mockReturnValue(mockPopup as unknown as Window)
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

  it('OAuth flow: shows authorizing status once popup opens', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.getByTestId('oauth-status').textContent).toContain('authorisation')
  })

  it('OAuth flow: shows success and calls onConnect + onClose when popup closes', () => {
    const { onConnect, onClose } = renderModal()
    fireEvent.click(screen.getByTestId('oauth-connect-btn'))
    act(() => { vi.advanceTimersByTime(100) }) // open popup

    // Simulate user completing OAuth in the popup
    mockPopup.closed = true
    act(() => { vi.advanceTimersByTime(500) }) // one poll interval
    expect(screen.getByTestId('oauth-status').textContent).toContain('Connected')

    // onConnect and onClose fire after the 800ms success delay
    expect(onConnect).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(800) })
    expect(onConnect).toHaveBeenCalledWith('linkedin')
    expect(onClose).toHaveBeenCalledTimes(1)
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
import Settings from '../src/pages/Settings'

function renderSettings() {
  return render(
    <HashRouter>
      <Settings />
    </HashRouter>
  )
}

describe('Settings – Connected Platforms tab', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as unknown as Window)
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
    // LinkedIn is connected by default
    expect(screen.getByTestId('platform-btn-linkedin').textContent).toBe('Disconnect')
    fireEvent.click(screen.getByTestId('platform-btn-linkedin'))
    // No modal
    expect(screen.queryByTestId('platform-connection-modal')).toBeNull()
    // Button now says Connect
    expect(screen.getByTestId('platform-btn-linkedin').textContent).toBe('Connect')
  })
})
