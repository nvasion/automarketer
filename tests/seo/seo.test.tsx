import { describe, it, expect, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import data from '../../src/seo/pageMeta.json'
import { INDEXABLE_ROUTES, META_ROUTES, SITE, headTags, notFoundMeta, pageMeta, tryPageMeta } from '../../src/seo/pageMeta'
import { jsonLdForRoute, stripHtml } from '../../src/seo/jsonLd'
import { headHtml, sitemapXml } from '../../src/seo/html'
import { usePageMeta } from '../../src/seo/usePageMeta'
import { prerenderableRoutes } from '../../src/entry-server'
import { FAQ } from '../../src/pages/public/content'

const allMeta = [...META_ROUTES.map((p) => pageMeta(p)), notFoundMeta()]

function ldScripts(html: string): Array<Record<string, unknown>> {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
}

describe('page metadata', () => {
  it('covers the public routes the spec lists', () => {
    expect(META_ROUTES).toEqual(['/', '/how-it-works', '/privacy', '/terms', '/login', '/register'])
    expect(INDEXABLE_ROUTES).toEqual(['/', '/how-it-works', '/privacy', '/terms'])
  })

  it('keeps every title within 65 characters', () => {
    for (const m of allMeta) expect(m.title.length, m.title).toBeLessThanOrEqual(65)
  })

  it('keeps every description between 70 and 160 characters', () => {
    for (const m of allMeta) {
      expect(m.description.length, m.description).toBeGreaterThanOrEqual(70)
      expect(m.description.length, m.description).toBeLessThanOrEqual(160)
    }
  })

  it('gives every page a unique title and description', () => {
    expect(new Set(allMeta.map((m) => m.title)).size).toBe(allMeta.length)
    expect(new Set(allMeta.map((m) => m.description)).size).toBe(allMeta.length)
  })

  it('throws for a route without metadata, and tryPageMeta returns undefined', () => {
    expect(() => pageMeta('/settings')).toThrow(/No page metadata/)
    expect(tryPageMeta('/settings')).toBeUndefined()
    expect(tryPageMeta('constructor')).toBeUndefined()
  })

  it('builds absolute canonical, og:url and og:image URLs', () => {
    const tags = headTags(pageMeta('/privacy'))
    const get = (k: string) => tags.find((t) => t.keyValue === k)?.value
    expect(get('canonical')).toBe('https://automarketer.tynhub.com/privacy')
    expect(get('og:url')).toBe('https://automarketer.tynhub.com/privacy')
    expect(get('og:image')).toBe(`${SITE.origin}/og-image.png`)
    expect(get('twitter:card')).toBe('summary_large_image')
    expect(get('robots')).toBe('index, follow')
  })

  it('marks noindex pages "noindex, follow" and gives the 404 page no canonical', () => {
    const login = headTags(pageMeta('/login'))
    expect(login.find((t) => t.keyValue === 'robots')?.value).toBe('noindex, follow')
    const nf = headTags(notFoundMeta())
    expect(nf.find((t) => t.keyValue === 'robots')?.value).toBe('noindex, follow')
    expect(nf.find((t) => t.keyValue === 'canonical')).toBeUndefined()
  })
})

describe('prerender coverage and sitemap', () => {
  it('can prerender every index:true route', () => {
    for (const path of INDEXABLE_ROUTES) expect(prerenderableRoutes).toContain(path)
  })

  it('lists only index:true routes in the sitemap', () => {
    const xml = sitemapXml(INDEXABLE_ROUTES.map((p) => ({ path: p, ...pageMeta(p) })))
    for (const p of INDEXABLE_ROUTES) expect(xml).toContain(`<loc>${SITE.origin}${p}</loc>`)
    expect(xml).not.toContain('/login')
    expect(xml).not.toContain('/register')
    expect(xml).toContain('<priority>1.0</priority>')
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
  })
})

describe('JSON-LD', () => {
  it('describes the product on the front page, without offers (no price in content.ts)', () => {
    const [app] = jsonLdForRoute('/')
    expect(app).toMatchObject({
      '@type': 'SoftwareApplication',
      name: 'AutoMarketer',
      url: data.site.origin,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      publisher: { '@type': 'Organization', name: 'TynHub', url: 'https://tynhub.com' },
    })
    expect(app).not.toHaveProperty('offers')
  })

  it('matches the FAQ on the front page word for word', () => {
    const faq = jsonLdForRoute('/').find((d) => d['@type'] === 'FAQPage') as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> }
    expect(faq.mainEntity).toHaveLength(FAQ.length)
    faq.mainEntity.forEach((q, i) => {
      expect(q.name).toBe(stripHtml(FAQ[i].q))
      expect(q.acceptedAnswer.text).toBe(stripHtml(FAQ[i].a))
      expect(q.acceptedAnswer.text).not.toMatch(/<[^>]+>/)
    })
  })

  it('gives the other indexed pages a breadcrumb from Home', () => {
    const [crumbs] = jsonLdForRoute('/privacy') as Array<{ '@type': string; itemListElement: Array<{ name: string; item: string }> }>
    expect(crumbs['@type']).toBe('BreadcrumbList')
    expect(crumbs.itemListElement.map((i) => i.name)).toEqual(['Home', 'Privacy policy'])
    expect(crumbs.itemListElement[1].item).toBe(`${SITE.origin}/privacy`)
  })

  it('emits JSON-LD that parses, for every indexed route', () => {
    for (const p of INDEXABLE_ROUTES) {
      const scripts = ldScripts(headHtml(pageMeta(p)))
      expect(scripts.length, p).toBeGreaterThan(0)
      for (const s of scripts) expect(s['@context']).toBe('https://schema.org')
    }
    expect(ldScripts(headHtml(pageMeta('/login')))).toHaveLength(0)
  })

  it('strips HTML from answers', () => {
    expect(stripHtml('Use <b>Settings</b> &rarr; <a href="#">AI</a> &amp; go')).toBe('Use Settings &rarr; AI & go')
  })
})

describe('usePageMeta', () => {
  afterEach(() => {
    document.head.innerHTML = ''
    document.title = ''
  })

  function Page({ path }: { path: string | null }) {
    usePageMeta(path)
    return null
  }

  it('sets the title and head tags while mounted and restores them after', () => {
    document.title = 'AutoMarketer'
    const view = render(<Page path="/how-it-works" />)
    expect(document.title).toBe(pageMeta('/how-it-works').title)
    expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute('content', pageMeta('/how-it-works').description)
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', `${SITE.origin}/how-it-works`)
    expect(document.head.querySelector('meta[property="og:image"]')).toHaveAttribute('content', `${SITE.origin}/og-image.png`)
    expect(document.head.querySelector('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image')
    view.unmount()
    expect(document.title).toBe('AutoMarketer')
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
  })

  it('updates tags already in the prerendered head instead of duplicating them', () => {
    document.head.innerHTML = '<meta name="description" content="from the prerender" />'
    const view = render(<Page path="/login" />)
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1)
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow')
    view.unmount()
    expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute('content', 'from the prerender')
  })

  it('marks the not-found page noindex', () => {
    render(<Page path={null} />)
    expect(document.title).toBe('Page not found - AutoMarketer')
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow')
  })
})
