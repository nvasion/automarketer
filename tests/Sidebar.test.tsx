import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { AuthContext } from '../src/contexts/AuthContext'
import Sidebar from '../src/components/Sidebar'
import type { PublicUser } from '../src/services/authService'

const mockUser: PublicUser = {
  id: '1',
  email: 'kellan.strong@ahead.com',
  createdAt: new Date().toISOString(),
}

function renderSidebar(logout = vi.fn()) {
  const authValue = {
    user: mockUser,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout,
  }
  return render(
    <HashRouter>
      <AuthContext.Provider value={authValue}>
        <Sidebar />
      </AuthContext.Provider>
    </HashRouter>
  )
}

describe('Sidebar user menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the user name and ellipsis button', () => {
    renderSidebar()
    expect(screen.getByText('Kellan Strong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /user menu/i })).toBeInTheDocument()
  })

  it('does not show the logout panel initially', () => {
    renderSidebar()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /log out/i })).not.toBeInTheDocument()
  })

  it('shows the logout panel when the ellipsis button is clicked', () => {
    renderSidebar()
    const menuButton = screen.getByRole('button', { name: /user menu/i })
    fireEvent.click(menuButton)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /log out/i })).toBeInTheDocument()
  })

  it('hides the logout panel when the ellipsis button is clicked again', () => {
    renderSidebar()
    const menuButton = screen.getByRole('button', { name: /user menu/i })
    fireEvent.click(menuButton)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.click(menuButton)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('sets aria-expanded correctly on the ellipsis button', () => {
    renderSidebar()
    const menuButton = screen.getByRole('button', { name: /user menu/i })
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(menuButton)
    expect(menuButton).toHaveAttribute('aria-expanded', 'true')
  })

  it('calls logout and closes the panel when Log out is clicked', async () => {
    const logout = vi.fn().mockResolvedValue(undefined)
    renderSidebar(logout)

    fireEvent.click(screen.getByRole('button', { name: /user menu/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }))

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes the logout panel when clicking outside', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: /user menu/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    // Simulate a click outside the sidebar bottom area
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
