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
  objectFit: 'cover',
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

const logoCreditStyle: React.CSSProperties = {
  color: '#64748b',
  fontSize: '10px',
  marginTop: '2px',
}

const logoCreditLinkStyle: React.CSSProperties = {
  color: '#52b788',
  textDecoration: 'none',
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
      <span style={{ fontSize: '15px', width: '20px', textAlign: 'center' }}>{icon}</span>
      <span>{label}</span>
      {label === 'New Campaign' && (
        <span
          style={{
            marginLeft: 'auto',
            background: '#40916c',
            color: isActive ? 'rgba(255,255,255,0.7)' : '#74c69d',
            border: isActive ? '1px solid rgba(255,255,255,0.2)' : '1px solid #2d6a4f',
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

function Sidebar() {
  const { user } = useAuth()
  const { fullName, initial } = user
    ? parseUserDetailsFromEmail(user.email)
    : { fullName: '', initial: '?' }

  return (
    <aside style={sidebarStyle}>
      <div style={logoAreaStyle}>
        <div style={logoStyle}>
          <img src="/automarketer.png" alt="AutoMarketer logo" style={logoIconStyle} />
          <div>
            <div style={logoTextStyle}>AutoMarketer</div>
            <div style={logoSubStyle}>AI Social Platform</div>
            <div style={logoCreditStyle}>
              By{' '}
              <a
                href="https://tynhub.com"
                target="_blank"
                rel="noopener noreferrer"
                style={logoCreditLinkStyle}
              >
                TynHub
              </a>{' '}
              and Built on{' '}
              <a
                href="https://factory-nexus.ai"
                target="_blank"
                rel="noopener noreferrer"
                style={logoCreditLinkStyle}
              >
                Factory Nexus
              </a>
            </div>
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

      <div style={bottomAreaStyle}>
        <div style={userCardStyle}>
          <div style={avatarStyle}>{initial}</div>
          <div>
            <div style={{ color: '#f1f5f9', fontSize: '13px', fontWeight: 500 }}>{fullName || user?.email}</div>
            <div style={{ color: '#64748b', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>{user?.email}</div>
          </div>
          <span style={{ color: '#64748b', marginLeft: 'auto', fontSize: '16px' }}>⋯</span>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
