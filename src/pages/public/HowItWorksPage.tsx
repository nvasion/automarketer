// The public walkthrough: each step of a campaign, with a screenshot of the
// real screen, where to find it in the app, and the details that matter.

import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { usePageMeta } from '../../seo/usePageMeta'
import { STEPS } from './content'
import { PublicLayout } from './PublicLayout'
import { Shot } from './Shot'

export default function HowItWorksPage() {
  usePageMeta('/how-it-works')
  const { user } = useAuth()
  const { hash } = useLocation()
  // A deep link such as /how-it-works#publish: the browser looks for the id
  // before React has rendered the steps, so scroll once they exist.
  useEffect(() => {
    const id = decodeURIComponent(hash.slice(1))
    if (id && STEPS.some((s) => s.id === id)) document.getElementById(id)?.scrollIntoView?.({ block: 'start' })
  }, [hash])
  return (
    <PublicLayout>
      <div className="doc">
        <aside className="doc-toc" aria-label="On this page">
          <span className="section-label">On this page</span>
          <ol>
            {STEPS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} onClick={(e) => jump(e, s.id)}>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </aside>
        <div className="doc-body">
          <h1 className="doc-title">How AutoMarketer works</h1>
          <p className="doc-lead">
            From a short brief to a post on every network you use, in six steps. These are screenshots of the app itself, with a demo campaign.
          </p>

          {STEPS.map((s, i) => (
            <section key={s.id} id={s.id} className="doc-section walk-step" aria-labelledby={`${s.id}-h`}>
              <h2 id={`${s.id}-h`}>
                <span className="step-n">{i + 1}</span>
                {s.title}
              </h2>
              <p className="doc-path">{s.where}</p>
              <p>{s.body}</p>
              {s.points && (
                <ul>
                  {s.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              {s.shot && <Shot name={s.shot.name} alt={s.shot.alt} path={s.shot.path} />}
            </section>
          ))}

          <div className="card doc-next">
            <h3>Ready for your first campaign?</h3>
            <p className="muted">Connect one network and try the wizard. Without an AI key it writes template posts, so you can see the whole flow first.</p>
            <div className="inline">
              {user ? (
                <Link className="btn primary" to="/create">
                  Start a campaign
                </Link>
              ) : (
                <>
                  <Link className="btn primary" to="/register">
                    Create your account
                  </Link>
                  <Link className="btn" to="/login">
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </PublicLayout>
  )
}

// The links are plain "#<step>" anchors (BrowserRouter leaves them alone, and
// they work without JavaScript); with it, scroll smoothly unless the visitor
// asked for reduced motion, and keep the anchor in the address bar.
function jump(e: React.MouseEvent, id: string) {
  const target = document.getElementById(id)
  if (!target) return
  e.preventDefault()
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView?.({ behavior: still ? 'auto' : 'smooth', block: 'start' })
  window.history.replaceState(window.history.state, '', `#${id}`)
}
