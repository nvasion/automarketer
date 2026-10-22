// Build-time prerender of the public pages (last step of `npm run build`).
//
// Reads the client build's dist/index.html as the template and the SSR bundle
// built from src/entry-server.tsx (dist-ssr/), then writes:
//   dist/spa.html               the untouched app shell + robots noindex; nginx
//                               serves it for the signed-in app's routes
//   dist/index.html             "/" with its own head, JSON-LD and body
//   dist/<route>/index.html     every other index:true route in pageMeta.json
//   dist/404.html               the not-found page, noindex, no app scripts
//   dist/sitemap.xml            the index:true routes
//
// The pages are not hydrated: in the browser main.tsx mounts the app with
// createRoot, which replaces the prerendered markup. The build fails when an
// index:true route cannot be rendered or renders without a body or an <h1>.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const ssr = await import(pathToFileURL(join(root, 'dist-ssr', 'entry-server.js')).href)

const template = readFileSync(join(dist, 'index.html'), 'utf8')

function write(rel, html) {
  const file = join(dist, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html)
  console.log(`prerender: ${rel} (${Buffer.byteLength(html)} bytes)`)
}

// 1. The SPA shell first, from the untouched template.
write('spa.html', ssr.spaHtml(template))

// 2. Every indexed route.
const routes = []
for (const path of ssr.INDEXABLE_ROUTES) {
  if (!ssr.prerenderableRoutes.includes(path)) {
    throw new Error(`prerender: "${path}" is index:true in src/seo/pageMeta.json but src/entry-server.tsx cannot render it`)
  }
  const meta = ssr.pageMeta(path)
  const body = ssr.renderRoute(path)
  if (!body || !body.trim()) throw new Error(`prerender: "${path}" rendered an empty body`)
  if (!/<h1[\s>]/.test(body)) throw new Error(`prerender: "${path}" rendered no <h1>`)
  const html = ssr.injectPage(template, ssr.headHtml(meta), body)
  write(path === '/' ? 'index.html' : join(path.slice(1), 'index.html'), html)
  console.log(`prerender:   ${ssr.visibleRootText(html).length} visible characters in #root`)
  routes.push({ path, changefreq: meta.changefreq, priority: meta.priority })
}

// 3. The static not-found page nginx serves with status 404.
write('404.html', ssr.notFoundHtml(template, ssr.notFoundMeta(), ssr.renderNotFound()))

// 4. The sitemap.
write('sitemap.xml', ssr.sitemapXml(routes))
