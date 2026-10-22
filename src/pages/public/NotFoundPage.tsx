// Any path the app does not know. In the app it renders in place; nginx
// serves the same page, prerendered as dist/404.html, with a real 404 status.

import { Link } from 'react-router-dom'
import { usePageMeta } from '../../seo/usePageMeta'
import { PublicLayout } from './PublicLayout'

export default function NotFoundPage() {
  usePageMeta(null)
  return (
    <PublicLayout>
      <div className="doc">
        <div className="doc-body not-found">
          <p className="doc-path">404</p>
          <h1 className="doc-title">Page not found</h1>
          <p className="doc-lead">
            There is no page at this address. It may have moved, or the link may be mistyped. AutoMarketer writes one post for each social network you use and
            publishes it through the platforms&rsquo; official APIs; start from one of these pages.
          </p>
          <div className="inline not-found-links">
            <Link className="btn primary" to="/">
              Go to the front page
            </Link>
            <Link className="btn" to="/how-it-works">
              See how it works
            </Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  )
}
