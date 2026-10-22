import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../src/contexts/AuthContext'
import { ThemeProvider } from '../src/components/Theme'
import App from '../src/App'
import { STEPS } from '../src/pages/public/content'
import type { PublicUser } from '../src/services/authService'
import { installMockCampaignsApi, uninstallMockCampaignsApi } from './helpers/mockCampaignsApi'

const signedIn: PublicUser = { id: '1', email: 'test@example.com', createdAt: new Date().toISOString() }

function renderAt(path: string, user: PublicUser | null = null) {
  const auth = { user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <AuthContext.Provider value={auth}>
          <App />
        </AuthContext.Provider>
      </MemoryRouter>
    </ThemeProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  installMockCampaignsApi()
})

afterEach(() => {
  uninstallMockCampaignsApi()
  document.documentElement.removeAttribute('data-theme')
})

describe('Public front page', () => {
  it('is what a signed-out visitor sees at /', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { level: 1, name: /write it once/i })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /get started/i }).length).toBeGreaterThan(0)
    expect(screen.queryByText('Total Campaigns')).not.toBeInTheDocument()
  })

  it('lists every supported platform with its character limit', () => {
    renderAt('/')
    const strip = screen.getByRole('list', { name: 'Platforms' })
    for (const name of ['LinkedIn', 'Reddit', 'Facebook', 'Instagram', 'Bluesky']) {
      expect(within(strip).getByText(name)).toBeInTheDocument()
    }
    expect(within(strip).getByText('280 chars')).toBeInTheDocument()
  })

  it('shows the dashboard instead when signed in', () => {
    renderAt('/', signedIn)
    expect(screen.getByText('Total Campaigns')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /write it once/i })).not.toBeInTheDocument()
  })
})

describe('How it works page', () => {
  it('walks through every step, signed out', () => {
    renderAt('/how-it-works')
    expect(screen.getByRole('heading', { level: 1, name: /how automarketer works/i })).toBeInTheDocument()
    for (const step of STEPS) {
      expect(screen.getByRole('heading', { level: 2, name: new RegExp(step.title.replace(/[’']/g, '.')) })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: /create your account/i })).toHaveAttribute('href', '/register')
  })

  it('links its table of contents to in-page step anchors', () => {
    renderAt('/how-it-works')
    const toc = screen.getByRole('complementary', { name: 'On this page' })
    for (const step of STEPS) {
      expect(within(toc).getByRole('link', { name: step.title })).toHaveAttribute('href', `#${step.id}`)
      expect(document.getElementById(step.id)).not.toBeNull()
    }
  })

  it('offers the app rather than sign-up when signed in', () => {
    renderAt('/how-it-works', signedIn)
    expect(screen.getByRole('link', { name: /open app/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /start a campaign/i })).toHaveAttribute('href', '/create')
    expect(screen.queryByRole('link', { name: /create your account/i })).not.toBeInTheDocument()
  })
})

describe('Theme', () => {
  it('starts in the AutoMarketer theme', () => {
    renderAt('/how-it-works')
    expect(document.documentElement).toHaveAttribute('data-theme', 'automarketer')
    const group = screen.getByRole('group', { name: 'Theme' })
    expect(within(group).getByRole('button', { name: 'AutoMarketer' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches between AutoMarketer, TynHub dark and TynHub light and remembers the choice', () => {
    renderAt('/how-it-works')
    const group = screen.getByRole('group', { name: 'Theme' })
    fireEvent.click(within(group).getByRole('button', { name: 'TynHub dark' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'tynhub-dark')
    expect(localStorage.getItem('automarketer.theme')).toBe('tynhub-dark')
    fireEvent.click(within(group).getByRole('button', { name: 'TynHub light' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'tynhub-light')
    fireEvent.click(within(group).getByRole('button', { name: 'AutoMarketer' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'automarketer')
    expect(localStorage.getItem('automarketer.theme')).toBe('automarketer')
  })

  it('keeps a stored TynHub theme', () => {
    localStorage.setItem('automarketer.theme', 'tynhub-light')
    renderAt('/how-it-works')
    expect(document.documentElement).toHaveAttribute('data-theme', 'tynhub-light')
  })
})
