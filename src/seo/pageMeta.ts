// Per-page metadata for the public pages, from one source of truth
// (pageMeta.json). usePageMeta applies it in the browser; the prerender
// (scripts/prerender.mjs, through src/entry-server.tsx) writes the same tags
// into the static HTML, so crawlers and link previews see them without JS.

import data from './pageMeta.json'

export interface RouteMeta {
  title: string
  description: string
  /** false: "noindex, follow", left out of the sitemap and the prerender. */
  index: boolean
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  priority: number
}

export interface PageMeta extends RouteMeta {
  /** The route path, or null for the not-found page (no canonical URL). */
  path: string | null
}

export const SITE = data.site
const ROUTES = data.routes as Record<string, RouteMeta>

/** Every route with metadata, in pageMeta.json order. */
export const META_ROUTES: string[] = Object.keys(ROUTES)

/** Routes that are indexed: prerendered and listed in the sitemap. */
export const INDEXABLE_ROUTES: string[] = META_ROUTES.filter((p) => ROUTES[p].index)

/** Metadata for a route, or undefined when the route has none. */
export function tryPageMeta(path: string): PageMeta | undefined {
  const meta = Object.prototype.hasOwnProperty.call(ROUTES, path) ? ROUTES[path] : undefined
  return meta ? { ...meta, path } : undefined
}

/** Metadata for a route; throws for a route missing from pageMeta.json. */
export function pageMeta(path: string): PageMeta {
  const meta = tryPageMeta(path)
  if (!meta) throw new Error(`No page metadata for "${path}" in src/seo/pageMeta.json`)
  return meta
}

/** The not-found page: never indexed, no canonical URL. */
export function notFoundMeta(): PageMeta {
  return { ...data.notFound, index: false, changefreq: 'never', priority: 0, path: null }
}

/** origin + path, for canonical and og:url. */
export function absoluteUrl(path: string): string {
  return `${SITE.origin}${path}`
}

/** One <meta> or <link> tag, as attribute pairs (rendered by usePageMeta and the prerender). */
export interface HeadTag {
  tag: 'meta' | 'link'
  /** The attribute that identifies the tag: name, property or rel. */
  key: 'name' | 'property' | 'rel'
  keyValue: string
  /** The attribute that carries the value: content or href. */
  valueAttr: 'content' | 'href'
  value: string
}

const meta = (key: 'name' | 'property', keyValue: string, value: string): HeadTag => ({ tag: 'meta', key, keyValue, valueAttr: 'content', value })

/**
 * The head tags for a page, besides <title>: description, robots, and for
 * pages with a path, canonical plus Open Graph and Twitter cards.
 */
export function headTags(page: PageMeta): HeadTag[] {
  const tags: HeadTag[] = [meta('name', 'description', page.description), meta('name', 'robots', page.index ? 'index, follow' : 'noindex, follow')]
  if (page.path === null) return tags
  const url = absoluteUrl(page.path)
  const image = absoluteUrl(SITE.image)
  tags.push(
    { tag: 'link', key: 'rel', keyValue: 'canonical', valueAttr: 'href', value: url },
    meta('property', 'og:title', page.title),
    meta('property', 'og:description', page.description),
    meta('property', 'og:url', url),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', SITE.name),
    meta('property', 'og:image', image),
    meta('property', 'og:image:width', String(SITE.imageWidth)),
    meta('property', 'og:image:height', String(SITE.imageHeight)),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', page.title),
    meta('name', 'twitter:description', page.description),
    meta('name', 'twitter:image', image),
  )
  return tags
}
