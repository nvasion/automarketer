import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { parseUserDetailsFromEmail } from '../utils/userDisplay'

const NAV_SECTIONS = [
  {
    label: 'Main Menu',
    items: [
      { path: '/', label: 'Dashboard' },
      { path: '/campaigns', label: 'Campaigns' },
      { path: '/create', label: 'New Campaign' },
      { path: '/scheduler', label: 'Scheduler' },
    ],
  },
  {
    label: 'Account',
    items: [
      { path: '/analytics', label: 'Analytics' },
      { path: '/settings', label: 'Settings' },
    ],
  },
]

/** Left navigation with the signed-in user at its foot. Styles: App.css (.nav). */
function Sidebar() {
  const location = useLocation()
  const { user, logout } = useAuth()
  const { fullName, initial } = user ? parseUserDetailsFromEmail(user.email) : { fullName: '', initial: '?' }

  const [showMenu, setShowMenu] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close the panel when the user clicks outside of it
  useEffect(() => {
    if (!showMenu) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMenu])

  async function handleLogout() {
    setShowMenu(false)
    await logout()
  }

  return (
    <aside className="nav">
      <nav className="nav-list" aria-label="App">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} style={{ display: 'contents' }}>
            <div className="nav-label">{section.label}</div>
            {section.items.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-item${location.pathname === item.path ? ' active' : ''}`}
                aria-current={location.pathname === item.path ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="nav-foot" ref={containerRef}>
        {showMenu && (
          <div className="menu" role="menu">
            <Link className="menu-item" role="menuitem" to="/how-it-works" onClick={() => setShowMenu(false)}>
              How it works
            </Link>
            <button className="menu-item danger" onClick={handleLogout} role="menuitem">
              Log out
            </button>
          </div>
        )}

        <div className="user-card">
          <div className="avatar">{initial}</div>
          <div style={{ minWidth: 0 }}>
            <div className="user-name">{fullName || user?.email}</div>
            <div className="user-email">{user?.email}</div>
          </div>
          <button
            className="btn small"
            aria-label="User menu"
            aria-expanded={showMenu}
            aria-haspopup="menu"
            onClick={() => setShowMenu((prev) => !prev)}
            style={{ marginLeft: 'auto', border: 0, color: 'var(--muted)', fontSize: '16px', padding: '0 6px' }}
          >
            ⋯
          </button>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
