import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { parseUserDetailsFromEmail } from '../utils/userDisplay'

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: '⬛' },
  { path: '/campaigns', label: 'Campaigns', icon: '📢' },
  { path: '/create', label: 'New Campaign', icon: '✨' },
  { path: '/scheduler', label: 'Scheduler', icon: '📅' },
  { path: '/analytics', label: 'Analytics', icon: '📊' },
  { path: '/settings', label: 'Settings', icon: '⚙️' },
]

const sidebarStyle: React.CSSProperties = {
  width: '240px',
  minHeight: '100vh',
  backgroundColor: '#0f172a',
  display: 'flex',
  flexDirection: 'column',
  padding: '0',
  flexShrink: 0,
  position: 'fixed',
  top: 0,
  left: 0,
  bottom: 0,
  overflowY: 'auto',
}

const logoAreaStyle: React.CSSProperties = {
  padding: '24px 20px 20px',
  borderBottom: '1px solid #1e293b',
}

const logoStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
}

const logoIconStyle: React.CSSProperties = {
  width: '36px',
  height: '36px',
  borderRadius: '10px',
  background: 'linear-gradient(135deg, #52b788, #40916c)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '18px',
  color: 'white',
  fontWeight: 'bold',
  flexShrink: 0,
}

const logoTextStyle: React.CSSProperties = {
  color: '#f1f5f9',
  fontWeight: 700,
  fontSize: '17px',
  letterSpacing: '-0.3px',
}

const logoSubStyle: React.CSSProperties = {
  color: '#64748b',
  fontSize: '11px',
  marginTop: '1px',
}

const navStyle: React.CSSProperties = {
  padding: '12px 12px',
  flex: 1,
}

const navSectionLabel: React.CSSProperties = {
  color: '#475569',
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  padding: '8px 8px 4px',
}

function NavItem({ path, label, icon }: { path: string; label: string; icon: string }) {
  const location = useLocation()
  const isActive = location.pathname === path

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 10px',
    borderRadius: '8px',
    color: isActive ? '#ffffff' : '#94a3b8',
    backgroundColor: isActive ? '#52b788' : 'transparent',
    marginBottom: '2px',
    fontSize: '14px',
    fontWeight: isActive ? 600 : 400,
    transition: 'all 0.15s ease',
    textDecoration: 'none',
  }

  return (
    <Link to={path} style={itemStyle}>
      <span style={{ fontSize: '15px', width: '20px', textAli
      <span>{label}</span>
      {label === 'New Campaign' && (
        <span
          style={{
            marginLeft: 'auto',
            background: '#40916c',
            color: isActive ? 'rgba(255,255,255,0.7)' : '#74c69d',
            border: isActive ? '1px solid rgba(255,255,255,0.
            borderRadius: '4px',
            fontSize: '10px',
            fontWeight: 600,
            padding: '1px 5px',
          }}
        >
          NEW
        </span>
      )}
    </Link>
  )
}

const bottomAreaStyle: React.CSSProperties = {
  padding: '16px 12px',
  borderTop: '1px solid #1e293b',
  position: 'relative',
}

const userCardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '8px 10px',
  borderRadius: '8px',
  cursor: 'pointer',
}

const avatarStyle: React.CSSProperties = {
  width: '32px',
  height: '32px',
  borderRadius: '50%',
  background: 'linear-gradient(135deg, #52b788, #40916c)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'white',
  fontSize: '13px',
  fontWeight: 600,
  flexShrink: 0,
}

const logoutPanelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '72px',
  left: '12px',
  right: '12px',
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '10px',
  padding: '6px',
  boxShadow: '0 -4px 16px rgba(0,0,0,0.4)',
  zIndex: 10,
}

const logoutButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  padding: '8px 10px',
  borderRadius: '6px',
  background: 'none',
  border: 'none',
  color: '#f87171',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
  textAlign: 'left',
}

function Sidebar() {
  const { user, logout } = useAuth()
  const { fullName, initial } = user
    ? parseUserDetailsFromEmail(user.email)
    : { fullName: '', initial: '?' }

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
    return () => document.removeEventListener('mousedown', ha
  }, [showMenu])

  async function handleLogout() {
    setShowMenu(false)
    await logout()
  }

  return (
    <aside style={sidebarStyle}>
      <div style={logoAreaStyle}>
        <div style={logoStyle}>
          <div style={logoIconStyle}>A</div>
          <div>
            <div style={logoTextStyle}>AutoMarketer</div>
            <div style={logoSubStyle}>AI Social Platform</div>
          </div>
        </div>
      </div>

      <nav style={navStyle}>
        <div style={navSectionLabel}>Main Menu</div>
        {NAV_ITEMS.slice(0, 4).map((item) => (
          <NavItem key={item.path} {...item} />
        ))}
        <div style={{ ...navSectionLabel, marginTop: '12px' }}>Account</div>
        {NAV_ITEMS.slice(4).map((item) => (
          <NavItem key={item.path} {...item} />
        ))}
      </nav>

      <div style={bottomAreaStyle} ref={containerRef}>
        {showMenu && (
          <div style={logoutPanelStyle} role="menu">
            <button
              style={logoutButtonStyle}
              onClick={handleLogout}
              role="menuitem"
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#7f1d1d22'
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.t'
              }}
            >
              <span aria-hidden="true">🚪</span>
              Log out
            </button>
          </div>
        )}

        <div style={userCardStyle}>
          <div style={avatarStyle}>{initial}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#f1f5f9', fontSize: '13px', || user?.email}</div>
            <div style={{ color: '#64748b', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px'
}}>{user?.email}</div>
          </div>
          <button
            aria-label="User menu"
            aria-expanded={showMenu}
            aria-haspopup="menu"
            onClick={() => setShowMenu((prev) => !prev)}
            style={{
              color: showMenu ? '#94a3b8' : '#64748b',
              marginLeft: 'auto',
              fontSize: '16px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 4px',
              borderRadius: '4px',
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ⋯
          </button>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
