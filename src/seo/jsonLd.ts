// Structured data (schema.org JSON-LD) for the prerendered public pages.
// The front page describes the product and its FAQ (from content.ts, so the
// answers match the page word for word); the other indexed pages carry a
// breadcrumb back to the front page. No offers: content.ts states no price.

import { FAQ } from '../pages/public/content'
import { SITE, absoluteUrl, pageMeta } from './pageMeta'

export type JsonLd = Record<string, unknown>

/** Plain text from a string that may carry HTML: tags removed, basic entities decoded, spaces collapsed. */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The page name in a breadcrumb: its title up to " - AutoMarketer" or the first " - ". */
function pageName(path: string): string {
  return pageMeta(path).title.split(' - ')[0]
}

export function jsonLdForRoute(path: string): JsonLd[] {
  const meta = pageMeta(path)
  if (!meta.index) return []

  if (path === '/') {
    return [
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: SITE.name,
        url: SITE.origin,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description: meta.description,
        publisher: { '@type': 'Organization', name: 'TynHub', url: 'https://tynhub.com' },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: FAQ.map((f) => ({
          '@type': 'Question',
          name: stripHtml(f.q),
          acceptedAnswer: { '@type': 'Answer', text: stripHtml(f.a) },
        })),
      },
    ]
  }

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
        { '@type': 'ListItem', position: 2, name: pageName(path), item: absoluteUrl(path) },
      ],
    },
  ]
}

/**
 * A JSON-LD object as the body of a <script> tag. "<" is escaped so no string
 * in the data can close the script element early.
 */
export function jsonLdScriptBody(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
