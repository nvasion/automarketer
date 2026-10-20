// The public walkthrough: each step of a campaign, with a screenshot of the
// real screen, where to find it in the app, and the details that matter.

import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { STEPS } from './content'
import { PublicLayout } from './PublicLayout'
import { Shot } from './Shot'

export default function HowItWorksPage() {
  const { user } = useAuth()
  return (
    <PublicLayout>
      <div className="doc">
        <aside className="doc-toc" aria-label="On this page">
          <span className="section-label">On this page</span>
          <ol>
            {STEPS.map((s) => (
              <li key={s.id}>
                <a href={`#/how-it-works`} onClick={(e) => jump(e, s.id)}>
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

// HashRouter owns the URL fragment, so in-page links scroll instead of navigating.
function jump(e: React.MouseEvent, id: string) {
  e.preventDefault()
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  document.getElementById(id)?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
}
