// Frame for the public pages (front page, how it works): a top bar with the
// brand and the way in, and a footer with the theme switch. Same structure
// and classes as Routini's public pages (routini/client/src/pages/public).

import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Lockup, Mark } from '../../components/Brand'
import { useAuth } from '../../contexts/AuthContext'
import { ThemeSwitch } from '../../components/Theme'

export function PublicLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return (
    <div className="public">
      <header className="public-nav">
        <Link className="brand" to="/" aria-label="AutoMarketer home">
          <Lockup size={32} />
        </Link>
        <nav className="public-links" aria-label="Site">
          <NavLink to="/how-it-works">How it works</NavLink>
          <a href="https://tynhub.com" target="_blank" rel="noopener noreferrer">
            TynHub
          </a>
        </nav>
        <div className="public-actions">
          {user ? (
            <Link className="btn primary" to="/">
              Open app
            </Link>
          ) : (
            <>
              <Link className="btn" to="/login">
                Sign in
              </Link>
              <Link className="btn primary" to="/register">
                Get started
              </Link>
            </>
          )}
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="public-footer">
        <div className="public-footer-inner">
          <span className="inline" style={{ gap: 8 }}>
            <Mark size={22} />
            <span>AutoMarketer · part of the TynHub network</span>
          </span>
          <span className="public-footer-links">
            <Link to="/how-it-works">How it works</Link>
            <a href="https://tynhub.com" target="_blank" rel="noopener noreferrer">
              TynHub
            </a>
            <a href="https://factory-nexus.ai" target="_blank" rel="noopener noreferrer">
              Built on Factory Nexus
            </a>
          </span>
          <ThemeSwitch />
        </div>
      </footer>
    </div>
  )
}
