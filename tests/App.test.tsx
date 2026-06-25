import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { AuthContext } from '../src/contexts/AuthContext'
import App from '../src/App'
import type { PublicUser } from '../src/services/authService'
import { CampaignModel } from '../src/db/CampaignModel'
import { installMockCampaignsApi, uninstallMockCampaignsApi } from './helpers/mockCampaignsApi'

// Provide an authenticated user so ProtectedRoute renders the app shell instead
// of redirecting to /login.
const mockUser: PublicUser = {
  id: '1',
  email: 'test@example.com',
  createdAt: new Date().toISOString(),
}

const authContextValue = {
  user: mockUser,
  loading: false,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}

function renderApp() {
  return render(
    <HashRouter>
      <AuthContext.Provider value={authContextValue}>
        <App />
      </AuthContext.Provider>
    </HashRouter>
  )
}

// Explicitly seed demo campaigns before each test so the dashboard has data.
beforeEach(() => {
  localStorage.clear()
  CampaignModel.seed()
  installMockCampaignsApi()
})

afterEach(() => {
  uninstallMockCampaignsApi()
})

describe('App', () => {
  it('renders the sidebar with brand name', () => {
    renderApp()
    expect(screen.getByText('AutoMarketer')).toBeDefined()
  })

  it('renders navigation links', () => {
    renderApp()
    // "Dashboard" appears in both the nav link and the page <h1>, so use getAllByText
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0)
    expect(screen.getByText('Campaigns')).toBeDefined()
    expect(screen.getByText('Scheduler')).toBeDefined()
  })

  it('renders dashboard heading', () => {
    renderApp()
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0)
  })

  it('renders campaign stats', () => {
    renderApp()
    expect(screen.getByText('Total Campaigns')).toBeDefined()
    expect(screen.getByText('Posts Published')).toBeDefined()
  })

  it('renders recent campaigns table with seeded campaign', async () => {
    renderApp()
    // The dashboard now loads campaigns asynchronously — wait for the data.
    await waitFor(() => {
      expect(screen.getByText('Acme SaaS Product Launch')).toBeDefined()
    })
    expect(screen.getByText('Recent Campaigns')).toBeDefined()
  })
})
