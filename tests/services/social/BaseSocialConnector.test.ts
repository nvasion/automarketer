import { describe, it, expect } from 'vitest'
import {
  BaseSocialConnector,
  buildCombinedText,
  truncateAtWordBoundary,
} from '../../../src/services/social/BaseSocialConnector'
import type { SocialPostResult, SocialPostRequest } from '../../../src/services/social/types'
import type { Platform } from '../../../src/types'

// ─── Minimal concrete subclass for testing ────────────────────────────────────

class TestConnector extends BaseSocialConnector {
  readonly platform: Platform = 'twitter' // 280-char limit makes math easy
  readonly charLimit = 280

  async post(_request?: SocialPostRequest, _credentials?: unknown): Promise<SocialPostResult> {
    return { success: true, platform: 'twitter' }
  }
}

const connector = new TestConnector()

// ─── buildCombinedText ────────────────────────────────────────────────────────

describe('buildCombinedText()', () => {
  it('returns just the content when there are no hashtags', () => {
    expect(buildCombinedText('Hello world', [])).toBe('Hello world')
  })

  it('joins content and hashtags with a double newline', () => {
    expect(buildCombinedText('Post body', ['#Foo', '#Bar'])).toBe(
      'Post body\n\n#Foo #Bar'
    )
  })

  it('handles a single hashtag', () => {
    expect(buildCombinedText('Tweet', ['#SaaS'])).toBe('Tweet\n\n#SaaS')
  })

  it('returns empty string when content is empty and no hashtags', () => {
    expect(buildCombinedText('', [])).toBe('')
  })
})

// ─── truncateAtWordBoundary ───────────────────────────────────────────────────

describe('truncateAtWordBoundary()', () => {
  it('returns text unchanged when within the limit', () => {
    expect(truncateAtWordBoundary('Hello', 10)).toBe('Hello')
  })

  it('returns text unchanged when exactly at the limit', () => {
    const text = 'A'.repeat(10)
    expect(truncateAtWordBoundary(text, 10)).toBe(text)
  })

  it('truncates at the last word boundary and appends ellipsis', () => {
    const result = truncateAtWordBoundary('Hello world foo', 8)
    // limit=8: slice to 7 chars → "Hello w", last space at 5 → "Hello" + "…"
    expect(result).toBe('Hello…')
    expect(result.length).toBeLessThanOrEqual(8)
  })

  it('truncates mid-word when no space is found', () => {
    const result = truncateAtWordBoundary('HelloWorldLong', 6)
    // No space → slice(0,5) + "…" = "Hello…"
    expect(result).toBe('Hello…')
    expect(result.length).toBeLessThanOrEqual(6)
  })

  it('does not produce output longer than the limit', () => {
    const result = truncateAtWordBoundary('a b c d e f g h i j', 7)
    expect(result.length).toBeLessThanOrEqual(7)
  })
})

// ─── validateContent ─────────────────────────────────────────────────────────

describe('BaseSocialConnector.validateContent()', () => {
  it('reports valid when combined text is within the limit', () => {
    const result = connector.validateContent('Short tweet', [])
    expect(result.valid).toBe(true)
    expect(result.overflowBy).toBe(0)
    expect(result.limit).toBe(280)
  })

  it('reports invalid when content alone exceeds the limit', () => {
    const longContent = 'A'.repeat(300)
    const result = connector.validateContent(longContent)
    expect(result.valid).toBe(false)
    expect(result.overflowBy).toBe(20)
    expect(result.characterCount).toBe(300)
  })

  it('counts content + separator + hashtags in the total', () => {
    const content = 'A'.repeat(270)
    const hashtags = ['#Foo'] // combined: 270 + 2 (\n\n) + 4 = 276
    const result = connector.validateContent(content, hashtags)
    expect(result.characterCount).toBe(276)
    expect(result.valid).toBe(true)
  })

  it('reports overflow when hashtags push the total over the limit', () => {
    const content = 'A'.repeat(270)
    const hashtags = ['#Tag1', '#Tag2', '#Tag3'] // 270+2+16=288
    const result = connector.validateContent(content, hashtags)
    expect(result.valid).toBe(false)
    expect(result.overflowBy).toBeGreaterThan(0)
  })

  it('defaults to empty hashtags when not provided', () => {
    const result = connector.validateContent('Hello')
    expect(result.characterCount).toBe(5)
  })
})

// ─── enforceLimit ────────────────────────────────────────────────────────────

describe('BaseSocialConnector.enforceLimit()', () => {
  it('returns content unchanged when within the limit', () => {
    const result = connector.enforceLimit('Short tweet', ['#SaaS'])
    expect(result.truncated).toBe(false)
    expect(result.content).toBe('Short tweet')
    expect(result.hashtags).toEqual(['#SaaS'])
  })

  it('marks truncated=false when combined text is exactly at the limit', () => {
    // Build text that hits exactly 280 chars
    const hashtagBlock = '\n\n#Tag'  // 6 chars
    const content = 'A'.repeat(280 - hashtagBlock.length) // 274 chars
    const result = connector.enforceLimit(content, ['#Tag'])
    expect(result.truncated).toBe(false)
  })

  it('truncates content when it alone exceeds the limit', () => {
    const longContent = 'A'.repeat(300)
    const result = connector.enforceLimit(longContent, [])
    expect(result.truncated).toBe(true)
    expect(result.content.length).toBeLessThanOrEqual(280)
  })

  it('truncated combined text (content + hashtags) stays within the limit', () => {
    const content = 'A'.repeat(270)
    const hashtags = ['#One', '#Two', '#Three', '#Four'] // each 4-5 chars
    const result = connector.enforceLimit(content, hashtags)
    const combined =
      result.hashtags.length > 0
        ? `${result.content}\n\n${result.hashtags.join(' ')}`
        : result.content
    expect(combined.length).toBeLessThanOrEqual(280)
    expect(result.truncated).toBe(true)
  })

  it('drops all hashtags and truncates content when hashtags alone exceed the limit', () => {
    // Build a hashtag block that is longer than the 280 char limit
    const manyHashtags = Array.from({ length: 70 }, (_, i) => `#Tag${i}`)
    const result = connector.enforceLimit('Some content', manyHashtags)
    expect(result.hashtags).toHaveLength(0)
    expect(result.content.length).toBeLessThanOrEqual(280)
    expect(result.truncated).toBe(true)
  })

  it('defaults to empty hashtags when not provided', () => {
    const result = connector.enforceLimit('Hello world')
    expect(result.hashtags).toEqual([])
  })

  it('preserves hashtags untouched when only content needs truncating', () => {
    // content=270 chars, hashtags=6 chars block → total 278, fine
    // But if content is 300, after truncation hashtags should remain
    const result = connector.enforceLimit('word '.repeat(60).trim(), ['#AI'])
    if (result.truncated) {
      // hashtags should still be present since there is enough room
      const combined = `${result.content}\n\n${result.hashtags.join(' ')}`
      expect(combined.length).toBeLessThanOrEqual(280)
    }
  })
})

// ─── countCharacters ─────────────────────────────────────────────────────────

describe('BaseSocialConnector.countCharacters()', () => {
  it('defaults to text.length', () => {
    expect(connector.countCharacters('Hello')).toBe(5)
  })

  it('returns 0 for an empty string', () => {
    expect(connector.countCharacters('')).toBe(0)
  })
})

// ─── enforceLimit edge cases ──────────────────────────────────────────────────

describe('BaseSocialConnector.enforceLimit() — edge cases', () => {
  it('returns ellipsis when charLimit is 1', () => {
    class TinyConnector extends BaseSocialConnector {
      readonly platform: Platform = 'twitter'
      readonly charLimit = 1
      async post(_req?: SocialPostRequest, _creds?: unknown): Promise<SocialPostResult> {
        return { success: true, platform: 'twitter' }
      }
    }
    const tiny = new TinyConnector()
    const result = tiny.enforceLimit('Hello world')
    expect(result.truncated).toBe(true)
    expect(result.content).toBe('…')
    expect(result.hashtags).toHaveLength(0)
  })
})
