// Server entry for the build-time prerender (npm run build:ssr, then
// scripts/prerender.mjs). It renders the PUBLIC pages only, signed out, to
// static HTML so crawlers and link previews get real content. There is no
// hydration contract: in the browser main.tsx mounts the app with createRoot,
// which replaces this markup.
//
// Import only public pages and their pieces here: never App.tsx or the
// signed-in app, which reach for the API, localStorage and window.

/* eslint-disable react-refresh/only-export-components -- a build-time server entry, never hot-reloaded */

import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import type { ReactElement } from 'react'
import { AuthContext } from './contexts/AuthContext'
import { DEFAULT_THEME, ThemeContext } from './lib/theme'
import { StaticPageContext } from './lib/staticPage'
import LandingPage from './pages/public/LandingPage'
import HowItWorksPage from './pages/public/HowItWorksPage'
import PrivacyPage from './pages/public/PrivacyPage'
import TermsPage from './pages/public/TermsPage'
import NotFoundPage from './pages/public/NotFoundPage'
import { INDEXABLE_ROUTES, notFoundMeta, pageMeta } from './seo/pageMeta'
import { headHtml, injectPage, notFoundHtml, sitemapXml, spaHtml, visibleRootText } from './seo/html'

const PAGES: Record<string, () => ReactElement> = {
  '/': () => <LandingPage />,
  '/how-it-works': () => <HowItWorksPage />,
  '/privacy': () => <PrivacyPage />,
  '/terms': () => <TermsPage />,
}

/** The routes this entry can render (every index:true route must be one). */
export const prerenderableRoutes: string[] = Object.keys(PAGES)

// Signed out, default theme, no network: the static page a first-time visitor sees.
const signedOut = {
  user: null,
  loading: false,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
}
const theme = { theme: DEFAULT_THEME, setTheme: () => {} }

function render(path: string, page: ReactElement): string {
  return renderToString(
    <StaticRouter location={path}>
      <ThemeContext.Provider value={theme}>
        <AuthContext.Provider value={signedOut}>{page}</AuthContext.Provider>
      </ThemeContext.Provider>
    </StaticRouter>,
  )
}

/** The body HTML (the contents of #root) for a public route. */
export function renderRoute(path: string): string {
  const page = PAGES[path]
  if (!page) throw new Error(`entry-server: "${path}" is not a prerenderable route`)
  return render(path, page())
}

/** The body HTML of the not-found page, served without scripts (no theme switch). */
export function renderNotFound(): string {
  return render(
    '/404',
    <StaticPageContext.Provider value={true}>
      <NotFoundPage />
    </StaticPageContext.Provider>,
  )
}

// Head and file helpers for scripts/prerender.mjs, built into the same bundle.
export { INDEXABLE_ROUTES, headHtml, injectPage, notFoundHtml, notFoundMeta, pageMeta, sitemapXml, spaHtml, visibleRootText }
