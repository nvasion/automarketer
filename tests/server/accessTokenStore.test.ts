// Unit tests for the per-user access token store, focused on the LinkedIn
// author ID (member URN) persistence that lets publishing work without the
// browser having to send the author ID with every request.
//
// These run fully in-memory: with DATABASE_URL unset, getPool() returns null
// and the store uses only its in-process cache.
import { describe, it, expect, beforeEach } from 'vitest'
import { accessTokenStore } from '../../server/models/accessTokenStore'

const USER = 'user-1'

describe('accessTokenStore author ID handling', () => {
  beforeEach(() => {
    accessTokenStore._clear()
  })

  it('stores and returns an authorId passed with the token', async () => {
    await accessTokenStore.setAccessToken(USER, 'linkedin', 'tok', {
      authorId: 'urn:li:person:abc123',
    })

    expect(accessTokenStore.getAccessToken(USER, 'linkedin')).toBe('tok')
    expect(accessTokenStore.getAuthorId(USER, 'linkedin')).toBe('urn:li:person:abc123')
  })

  it('returns null for an authorId that was never resolved', async () => {
    await accessTokenStore.setAccessToken(USER, 'linkedin', 'tok')
    expect(accessTokenStore.getAuthorId(USER, 'linkedin')).toBeNull()
  })

  it('preserves a previously resolved authorId when the token is re-stored without one', async () => {
    await accessTokenStore.setAccessToken(USER, 'linkedin', 'tok', {
      authorId: 'urn:li:person:abc123',
    })

    // Simulate a token-only refresh that does not carry the author ID.
    await accessTokenStore.setAccessToken(USER, 'linkedin', 'tok2', {
      expiresAt: '2099-01-01T00:00:00.000Z',
    })

    expect(accessTokenStore.getAccessToken(USER, 'linkedin')).toBe('tok2')
    expect(accessTokenStore.getAuthorId(USER, 'linkedin')).toBe('urn:li:person:abc123')
  })

  it('backfills an authorId via setAuthorId without disturbing the token or expiry', async () => {
    // A connection made before author IDs were persisted: token but no URN.
    await accessTokenStore.setAccessToken(USER, 'linkedin', 'tok', {
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    expect(accessTokenStore.getAuthorId(USER, 'linkedin')).toBeNull()

    await accessTokenStore.setAuthorId(USER, 'linkedin', 'urn:li:person:backfilled')

    expect(accessTokenStore.getAuthorId(USER, 'linkedin')).toBe('urn:li:person:backfilled')
    // Token must still be usable (not wiped, expiry not cleared).
    expect(accessTokenStore.getAccessToken(USER, 'linkedin')).toBe('tok')
  })

  it('setAuthorId is a no-op when no token is cached for the platform', async () => {
    await accessTokenStore.setAuthorId(USER, 'linkedin', 'urn:li:person:orphan')
    expect(accessTokenStore.getAuthorId(USER, 'linkedin')).toBeNull()
  })
})
