// The AutoMarketer emblem (cut from the delivered logo, public/automarketer.png,
// on its own white tile) and the lockup used in the masthead. The wordmark is
// live text in TynHub's signage face, as Routini's is.

import { Link } from 'react-router-dom'
import markUrl from '../assets/brand/mark.webp'

export function Mark({ size = 32, label }: { size?: number; label?: string }) {
  return (
    <img
      className="mark"
      src={markUrl}
      width={size}
      height={size}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      draggable={false}
    />
  )
}

/** Top of the sign-in and sign-up cards: lockup back to the front page, plus credits. */
export function AuthBrand() {
  return (
    <div className="auth-brand">
      <Link to="/" aria-label="AutoMarketer home" className="brand">
        <Mark size={48} />
      </Link>
      <span className="brand-name" style={{ fontSize: 26 }}>
        AutoMarketer
      </span>
      <span className="auth-credit">
        By{' '}
        <a href="https://tynhub.com" target="_blank" rel="noopener noreferrer">
          TynHub
        </a>{' '}
        and Built on{' '}
        <a href="https://factory-nexus.ai" target="_blank" rel="noopener noreferrer">
          Factory Nexus
        </a>
      </span>
    </div>
  )
}

/** Emblem + wordmark, with an optional registry line under the name. */
export function Lockup({ size = 32, sub }: { size?: number; sub?: string }) {
  return (
    <span className="lockup">
      <Mark size={size} />
      <span className="lockup-text">
        <span className="brand-name" style={{ fontSize: Math.round(size * 0.62) }}>
          AutoMarketer
        </span>
        {sub && <span className="brand-sub">{sub}</span>}
      </span>
    </span>
  )
}
