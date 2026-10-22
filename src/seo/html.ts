// String work for the prerender: head tags, page injection into the built
// index.html template, the noindex SPA shell, the static 404 page and the
// sitemap. Pure functions, so tests can run them against any template.
//
// Every replace() below uses a FUNCTION replacer: with a string replacer, a
// "$1", "$&" or "$'" in page copy would be read as a substitution pattern and
// corrupt the output.

import { absoluteUrl, headTags, type PageMeta } from './pageMeta'
import { jsonLdForRoute, jsonLdScriptBody } from './jsonLd'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Escape text for an HTML attribute value or text node. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c])
}

const TITLE_RE = /<title>[\s\S]*?<\/title>/
const ROOT_RE = /<div id="root"><\/div>/

/** <title>, meta/link tags and (for indexed routes) JSON-LD scripts for a page. */
export function headHtml(page: PageMeta): string {
  const lines = [`<title>${escapeHtml(page.title)}</title>`]
  for (const t of headTags(page)) {
    lines.push(`<${t.tag} ${t.key}="${escapeHtml(t.keyValue)}" ${t.valueAttr}="${escapeHtml(t.value)}" />`)
  }
  if (page.path !== null && page.index) {
    for (const data of jsonLdForRoute(page.path)) {
      lines.push(`<script type="application/ld+json">${jsonLdScriptBody(data)}</script>`)
    }
  }
  return lines.join('\n    ')
}

function requireMatch(template: string, re: RegExp, what: string) {
  if (!re.test(template)) throw new Error(`prerender: the template has no ${what}`)
}

/** The template with a page's head and its rendered body in #root. */
export function injectPage(template: string, head: string, body: string): string {
  requireMatch(template, TITLE_RE, '<title> to replace')
  requireMatch(template, ROOT_RE, 'empty <div id="root"></div>')
  return template.replace(TITLE_RE, () => head).replace(ROOT_RE, () => `<div id="root">${body}</div>`)
}

/** The untouched app shell, marked noindex: nginx serves it for the signed-in app's routes. */
export function spaHtml(template: string): string {
  if (!template.includes('</head>')) throw new Error('prerender: the template has no </head>')
  return template.replace('</head>', () => '<meta name="robots" content="noindex" />\n  </head>')
}

/** Drop module scripts and module preloads: the static 404 page must not boot the app. */
export function stripModuleScripts(html: string): string {
  return html
    .replace(/[ \t]*<script\b[^>]*\btype="module"[^>]*>[\s\S]*?<\/script>\s*/g, () => '')
    .replace(/[ \t]*<link\b[^>]*\brel="modulepreload"[^>]*>\s*/g, () => '')
}

/** The static 404 page: the not-found body, noindex, no app scripts. */
export function notFoundHtml(template: string, page: PageMeta, body: string): string {
  return stripModuleScripts(injectPage(template, headHtml(page), body))
}

/** sitemap.xml of the indexed routes. */
export function sitemapXml(routes: Array<{ path: string; changefreq: string; priority: number }>): string {
  const urls = routes.map(
    (r) =>
      `  <url>\n    <loc>${escapeHtml(absoluteUrl(r.path))}</loc>\n    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority.toFixed(1)}</priority>\n  </url>`,
  )
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

/** Visible text inside #root: tags, scripts and styles removed, whitespace collapsed. */
export function visibleRootText(html: string): string {
  const start = html.indexOf('<div id="root">')
  if (start === -1) return ''
  const root = html.slice(start)
  return root
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim()
}
