// The privacy policy and terms pages: the public layout's document frame (as
// How it works), with an in-page table of contents, an h1, the date and one
// h2 section per heading in legal.ts.

import type { ReactNode } from 'react'
import { LEGAL_CONTACT, LEGAL_UPDATED, type LegalDoc } from './legal'
import { PublicLayout } from './PublicLayout'

/** Text with the contact address as a mailto link. */
function withContact(text: string): ReactNode {
  const parts = text.split(LEGAL_CONTACT)
  if (parts.length === 1) return text
  return parts.flatMap((part, i) =>
    i === 0
      ? [part]
      : [
          <a key={i} href={`mailto:${LEGAL_CONTACT}`}>
            {LEGAL_CONTACT}
          </a>,
          part,
        ],
  )
}

export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <PublicLayout>
      <div className="doc">
        <aside className="doc-toc" aria-label="On this page">
          <span className="section-label">On this page</span>
          <ol>
            {doc.sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.heading}</a>
              </li>
            ))}
          </ol>
        </aside>
        <article className="doc-body legal">
          <h1 className="doc-title">{doc.title}</h1>
          <p className="doc-path">Last updated: {LEGAL_UPDATED}</p>
          <p className="doc-lead">{doc.lead}</p>
          {doc.sections.map((s) => (
            <section key={s.id} id={s.id} className="doc-section" aria-labelledby={`${s.id}-h`}>
              <h2 id={`${s.id}-h`}>{s.heading}</h2>
              {s.paragraphs?.map((p) => <p key={p}>{withContact(p)}</p>)}
              {s.items && (
                <ul>
                  {s.items.map((item) => (
                    <li key={item}>{withContact(item)}</li>
                  ))}
                </ul>
              )}
              {s.after?.map((p) => <p key={p}>{withContact(p)}</p>)}
            </section>
          ))}
        </article>
      </div>
    </PublicLayout>
  )
}
