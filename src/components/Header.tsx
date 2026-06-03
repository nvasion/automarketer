import { Link } from 'react-router-dom'

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '1rem 2rem',
  backgroundColor: '#1a1a1a',
  color: '#ffffff',
}

const navStyle: React.CSSProperties = {
  display: 'flex',
  gap: '1.5rem',
}

const linkStyle: React.CSSProperties = {
  color: '#ffffff',
  textDecoration: 'none',
  fontWeight: 500,
}

function Header() {
  return (
    <header style={headerStyle}>
      <Link to="/" style={linkStyle}>
        <h2>AutoMarketer</h2>
      </Link>
      <nav style={navStyle}>
        <Link to="/" style={linkStyle}>Home</Link>
        <Link to="/about" style={linkStyle}>About</Link>
      </nav>
    </header>
  )
}

export default Header
