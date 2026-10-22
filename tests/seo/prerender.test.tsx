import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { escapeHtml, headHtml, injectPage, notFoundHtml, spaHtml, stripModuleScripts, visibleRootText } from '../../src/seo/html'
import { INDEXABLE_ROUTES, notFoundMeta, pageMeta, type PageMeta } from '../../src/seo/pageMeta'
import { prerenderableRoutes, renderNotFound, renderRoute } from '../../src/entry-server'

// The shape of Vite's built dist/index.html: module script and preloads in the head.
const BUILT = `<!DOCTYPE html>
<html lang="en" data-theme="automarketer">
  <head>
    <meta charset="UTF-8" />
    <title>AutoMarketer</title>
    <script>try { var t = localStorage.getItem('automarketer.theme') } catch (e) {}</script>
    <script type="module" crossorigin src="/assets/index-AbC123.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-XyZ789.js">
    <link rel="stylesheet" crossorigin href="/assets/index-Def456.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`
// The source index.html, as Vite reads it.
const SOURCE = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8')

const h1Count = (html: string) => (html.match(/<h1[\s>]/g) ?? []).length

describe('injectPage', () => {
  it('is safe against $ patterns in head and body copy', () => {
    const tricky = "costs $1, $& and $' and $` and $$"
    const html = injectPage(BUILT, `<title>${tricky}</title>`, `<p>${tricky}</p>`)
    expect(html).toContain(`<title>${tricky}</title>`)
    expect(html).toContain(`<div id="root"><p>${tricky}</p></div>`)
    expect(html).toContain('<link rel="stylesheet" crossorigin href="/assets/index-Def456.css">')
    expect(html.match(/<title>/g)).toHaveLength(1)
  })

  it('escapes attribute values in the head', () => {
    const page: PageMeta = { ...pageMeta('/terms'), title: 'Say "hi" <now> & $& go', description: `It's $1 "quoted" & <b>bold</b>` }
    const head = headHtml(page)
    expect(head).toContain('<title>Say &quot;hi&quot; &lt;now&gt; &amp; $&amp; go</title>')
    expect(head).toContain(`content="${escapeHtml(page.description)}"`)
    expect(head).not.toContain('<b>')
    const html = injectPage(BUILT, head, '<h1>x</h1>')
    expect(html).toContain('$&amp; go')
  })

  it('works on the source index.html too', () => {
    const html = injectPage(SOURCE, headHtml(pageMeta('/')), renderRoute('/'))
    expect(html).toContain(`<title>${escapeHtml(pageMeta('/').title)}</title>`)
    expect(html).toContain('<meta name="description"')
  })

  it('refuses a template without an empty #root', () => {
    expect(() => injectPage('<title>x</title><div id="root"><p>already</p></div>', '', '')).toThrow(/root/)
  })
})

describe('spa.html', () => {
  it('is the untouched template with robots noindex', () => {
    const html = spaHtml(BUILT)
    expect(html).toContain('<meta name="robots" content="noindex" />')
    expect(html).toContain('<div id="root"></div>')
    expect(html).toContain('type="module"')
    expect(html.replace('<meta name="robots" content="noindex" />\n  ', '')).toBe(BUILT)
  })
})

describe('404.html', () => {
  const html = notFoundHtml(BUILT, notFoundMeta(), renderNotFound())

  it('has no module script or module preload', () => {
    expect(html).not.toMatch(/type="module"/)
    expect(html).not.toMatch(/modulepreload/)
    expect(stripModuleScripts(SOURCE)).not.toMatch(/type="module"/)
  })

  it('keeps the stylesheet and the theme script, and is noindex', () => {
    expect(html).toContain('rel="stylesheet"')
    expect(html).toContain("localStorage.getItem('automarketer.theme')")
    expect(html).toContain('<meta name="robots" content="noindex, follow" />')
    expect(html).not.toContain('rel="canonical"')
  })

  it('says the page was not found, with one h1 and links to the front page and how it works', () => {
    expect(h1Count(html)).toBe(1)
    expect(html).toMatch(/<h1[^>]*>Page not found<\/h1>/)
    expect(html).toContain('href="/"')
    expect(html).toContain('href="/how-it-works"')
  })

  it('leaves out the theme switch, which needs the app scripts', () => {
    expect(html).not.toContain('aria-label="Theme"')
    expect(renderRoute('/privacy')).toContain('aria-label="Theme"')
  })
})

describe('prerendered public pages', () => {
  it('has exactly one h1 on every prerenderable route', () => {
    for (const path of prerenderableRoutes) expect(h1Count(renderRoute(path)), path).toBe(1)
  })

  it('renders more than 500 visible characters in #root for every indexed route', () => {
    for (const path of INDEXABLE_ROUTES) {
      const html = injectPage(BUILT, headHtml(pageMeta(path)), renderRoute(path))
      expect(visibleRootText(html).length, path).toBeGreaterThan(500)
    }
  })

  it('renders signed out, with crawlable links to the public pages', () => {
    const html = renderRoute('/')
    expect(html).toContain('href="/register"')
    expect(html).toContain('href="/how-it-works"')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/terms"')
    expect(html).not.toContain('Open your dashboard')
  })

  it('refuses a route it cannot render', () => {
    expect(() => renderRoute('/settings')).toThrow(/not a prerenderable route/)
  })
})
