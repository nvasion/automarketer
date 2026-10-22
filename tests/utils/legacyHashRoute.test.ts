import { describe, it, expect } from 'vitest'
import { legacyHashPath } from '../../src/utils/legacyHashRoute'

describe('legacyHashPath', () => {
  it('maps an old hash route to the real path', () => {
    expect(legacyHashPath('#/how-it-works', '')).toBe('/how-it-works')
    expect(legacyHashPath('#/campaigns/abc-123/edit', '')).toBe('/campaigns/abc-123/edit')
  })

  it('maps the bare hash root to /', () => {
    expect(legacyHashPath('#/', '')).toBe('/')
  })

  it('keeps the query string the hash route carried', () => {
    expect(legacyHashPath('#/settings?tab=platforms', '')).toBe('/settings?tab=platforms')
  })

  it('keeps the query string from before the hash', () => {
    expect(legacyHashPath('#/register', '?utm_source=mail')).toBe('/register?utm_source=mail')
  })

  it('combines both query strings, hash route first', () => {
    expect(legacyHashPath('#/settings?tab=ai', '?ref=mail')).toBe('/settings?tab=ai&ref=mail')
  })

  it('keeps an in-page anchor inside the old route', () => {
    expect(legacyHashPath('#/how-it-works#connect', '')).toBe('/how-it-works#connect')
    expect(legacyHashPath('#/how-it-works?x=1#connect', '?y=2')).toBe('/how-it-works?x=1&y=2#connect')
  })

  it('leaves plain anchors and empty hashes alone', () => {
    expect(legacyHashPath('', '')).toBeNull()
    expect(legacyHashPath('#', '')).toBeNull()
    expect(legacyHashPath('#connect', '?a=1')).toBeNull()
  })
})
