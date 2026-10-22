// Applies a page's metadata (src/seo/pageMeta.json) to document.head while
// the page is mounted: title, description, robots, canonical, Open Graph and
// Twitter tags. Prerendered pages already carry the same tags; this keeps them
// right as the visitor moves between pages in the app. On unmount every tag
// goes back to what it was, so a page without metadata never inherits one.

import { useEffect } from 'react'
import { headTags, notFoundMeta, pageMeta, type PageMeta } from './pageMeta'

/** `path` is a route in pageMeta.json, or null for the not-found page. */
export function usePageMeta(path: string | null) {
  useEffect(() => {
    const page: PageMeta = path === null ? notFoundMeta() : pageMeta(path)
    const restore: Array<() => void> = []

    const prevTitle = document.title
    document.title = page.title
    restore.push(() => {
      document.title = prevTitle
    })

    for (const t of headTags(page)) {
      let el = document.head.querySelector<HTMLElement>(`${t.tag}[${t.key}="${t.keyValue}"]`)
      if (el) {
        const node = el
        const prev = node.getAttribute(t.valueAttr)
        restore.push(() => (prev === null ? node.removeAttribute(t.valueAttr) : node.setAttribute(t.valueAttr, prev)))
      } else {
        el = document.createElement(t.tag)
        el.setAttribute(t.key, t.keyValue)
        document.head.appendChild(el)
        const node = el
        restore.push(() => node.remove())
      }
      el.setAttribute(t.valueAttr, t.value)
    }

    return () => {
      for (const undo of restore.reverse()) undo()
    }
  }, [path])
}
