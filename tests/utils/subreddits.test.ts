import { describe, it, expect } from 'vitest'
import { isValidSubredditName, normalizeSubreddits } from '../../src/utils/subreddits'

describe('normalizeSubreddits', () => {
  it('returns an empty array for undefined and null', () => {
    expect(normalizeSubreddits(undefined)).toEqual([])
    expect(normalizeSubreddits(null)).toEqual([])
  })

  it('returns an empty array for empty and whitespace-only strings', () => {
    expect(normalizeSubreddits('')).toEqual([])
    expect(normalizeSubreddits('   ')).toEqual([])
    expect(normalizeSubreddits([])).toEqual([])
    expect(normalizeSubreddits(['', '  '])).toEqual([])
  })

  it('accepts a single subreddit string', () => {
    expect(normalizeSubreddits('programming')).toEqual(['programming'])
  })

  it('accepts an array of subreddits', () => {
    expect(normalizeSubreddits(['startups', 'SaaS'])).toEqual(['startups', 'SaaS'])
  })

  it('strips "r/" and "/r/" prefixes', () => {
    expect(normalizeSubreddits('r/programming')).toEqual(['programming'])
    expect(normalizeSubreddits('/r/programming')).toEqual(['programming'])
    expect(normalizeSubreddits(['R/startups'])).toEqual(['startups'])
  })

  it('splits comma-separated lists in a single string', () => {
    expect(normalizeSubreddits('r/startups, SaaS,programming')).toEqual([
      'startups',
      'SaaS',
      'programming',
    ])
  })

  it('trims whitespace around entries', () => {
    expect(normalizeSubreddits(['  startups  ', ' SaaS'])).toEqual(['startups', 'SaaS'])
  })

  it('dedupes case-insensitively, preserving first-seen casing', () => {
    expect(normalizeSubreddits(['SaaS', 'saas', 'r/SAAS'])).toEqual(['SaaS'])
  })
})

describe('isValidSubredditName', () => {
  it('accepts plain alphanumeric names with underscores', () => {
    expect(isValidSubredditName('programming')).toBe(true)
    expect(isValidSubredditName('ask_science')).toBe(true)
    expect(isValidSubredditName('SaaS')).toBe(true)
  })

  it('rejects names with invalid characters', () => {
    expect(isValidSubredditName('not a sub')).toBe(false)
    expect(isValidSubredditName('bad-name')).toBe(false)
    expect(isValidSubredditName('https://reddit.com')).toBe(false)
  })

  it('rejects empty names and names over 21 characters', () => {
    expect(isValidSubredditName('')).toBe(false)
    expect(isValidSubredditName('a'.repeat(22))).toBe(false)
    expect(isValidSubredditName('a'.repeat(21))).toBe(true)
  })

  it('rejects names starting with an underscore', () => {
    expect(isValidSubredditName('_private')).toBe(false)
  })
})
