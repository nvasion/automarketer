// The public front page, campaign style (as Routini's): a bold pitch on the
// logo's own slate ground, how it works in four steps, the platforms, what it
// does, where it's at, and the questions people ask first.

import { Link } from 'react-router-dom'
import tile from '../../assets/brand/tile.webp'
import PlatformBadge from '../../components/PlatformBadge'
import { PLATFORM_CONFIGS } from '../../data/sampleData'
import { useAuth } from '../../contexts/AuthContext'
import { FAQ, FEATURES, NEXT, SHIPPED, STEPS } from './content'
import { PublicLayout } from './PublicLayout'
import { Shot } from './Shot'

const BADGES = ['6 social networks', 'Bring your own AI model', 'Keys stay in your browser', 'Official platform APIs', 'Part of the TynHub network']

// The four steps the front page shows; the full walkthrough has all of them.
const PREVIEW = ['connect', 'describe', 'review', 'publish']

export default function LandingPage() {
  const { user } = useAuth()
  const primary = user ? (
    <Link className="btn primary hero-btn" to="/">
      Open your dashboard
    </Link>
  ) : (
    <Link className="btn primary hero-btn" to="/register">
      Get started
    </Link>
  )

  return (
    <PublicLayout>
      <section className="hero" aria-labelledby="hero-title">
        <img className="hero-tile" src={tile} alt="AutoMarketer" width={240} height={240} />
        <h1 id="hero-title" className="hero-title">
          Write it once. Post it everywhere.
        </h1>
        <p className="hero-lead">
          Describe what you&rsquo;re marketing and pick your networks. AutoMarketer writes a post for each one, in its voice and within its limit, and publishes it
          to LinkedIn, X, Reddit, Facebook, Instagram and Bluesky.
        </p>
        <div className="hero-cta">
          {primary}
          <Link className="btn hero-btn" to="/how-it-works">
            See how it works
          </Link>
        </div>
        <ul className="badges" aria-label="Highlights">
          {BADGES.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </section>

      <section className="public-section" aria-labelledby="how">
        <h2 id="how" className="public-h2">
          How it works
        </h2>
        <ol className="preview-steps">
          {STEPS.filter((s) => PREVIEW.includes(s.id)).map((s, i) => (
            <li key={s.id} className="card preview-step">
              {s.shot && <Shot name={s.shot.name} alt={s.shot.alt} path={s.shot.path} />}
              <div className="preview-body">
                <span className="step-n">{i + 1}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <Link className="install-more" to="/how-it-works">
          The full walkthrough, screen by screen →
        </Link>
      </section>

      <section className="public-section" aria-labelledby="where">
        <h2 id="where" className="public-h2">
          Where it posts
        </h2>
        <ul className="platform-strip" aria-label="Platforms">
          {PLATFORM_CONFIGS.map((p) => (
            <li key={p.id} className="card">
              <PlatformBadge platform={p.id} size="lg" />
              <span className="platform-name">{p.name}</span>
              <span className="mono muted">{p.charLimit.toLocaleString('en-US')} chars</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="public-section" aria-labelledby="what">
        <h2 id="what" className="public-h2">
          What it does
        </h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="card feature">
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="public-section" aria-labelledby="progress">
        <h2 id="progress" className="public-h2">
          Where it&rsquo;s at
        </h2>
        <div className="progress-grid">
          <div className="card">
            <h3 className="progress-h done">Shipped</h3>
            <ul className="progress-list">
              {SHIPPED.map((s) => (
                <li key={s}>
                  <span className="tick" aria-hidden="true">
                    ✓
                  </span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h3 className="progress-h next">Next</h3>
            <ul className="progress-list">
              {NEXT.map((s) => (
                <li key={s}>
                  <span className="tick next" aria-hidden="true">
                    →
                  </span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="public-section" aria-labelledby="faq">
        <h2 id="faq" className="public-h2">
          Questions
        </h2>
        <div className="faq">
          {FAQ.map((f) => (
            <details key={f.q} className="card">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="final-cta" aria-label="Get started">
        <h2 className="public-h2">Your next campaign, on every network.</h2>
        <div className="hero-cta">
          {primary}
          <Link className="btn hero-btn" to="/how-it-works">
            See how it works
          </Link>
        </div>
      </section>
    </PublicLayout>
  )
}
