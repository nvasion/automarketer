import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { AuthContext } from '../src/contexts/AuthContext'
import App from '../src/App'
import type { PublicUser } from '../src/services/authService'

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

  it('renders recent campaigns table', () => {
    renderApp()
    expect(screen.getByText('Recent Campaigns')).toBeDefined()
    expect(screen.getByText('Acme SaaS Product Launch')).toBeDefined()
  })
})
