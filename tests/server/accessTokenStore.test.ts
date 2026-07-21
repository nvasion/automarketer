// Unit tests for the per-user access token store, focused on the LinkedIn
// author ID (member URN) persistence that lets publishing work without the
// browser having to send the author ID with every request.
//
// These run fully in-memory: with DATABASE_URL unset, getPool() returns null
// and the store uses only its in-process cache.
import { describe, it, expect, beforeEach } from 'vitest'
import { accessTokenStore, agentCredentialStore } from '../../server/models/accessTokenStore'
import type { AgentCredentials } from '../../server/types/agentAuth'

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

// ── agentCredentialStore ──────────────────────────────────────────────────────
// Runs fully in-memory: with DATABASE_URL unset, getPool() returns null, so
// setCredentials/getCredentials fall back to the in-process cache only —
// exactly like the accessTokenStore tests above.
describe('agentCredentialStore', () => {
  const CREDS: AgentCredentials = {
    username: 'reddit-user',
    password: 'hunter2',
    clientId: 'client-abc',
    clientSecret: 'secret-xyz',
  }

  beforeEach(() => {
    agentCredentialStore._clear()
  })

  it('returns null when no credentials have been stored for the platform', async () => {
    await expect(agentCredentialStore.getCredentials(USER, 'reddit')).resolves.toBeNull()
  })

  it('stores and retrieves credentials for a user/platform pair', async () => {
    await agentCredentialStore.setCredentials(USER, 'reddit', CREDS)
    await expect(agentCredentialStore.getCredentials(USER, 'reddit')).resolves.toEqual(CREDS)
  })

  it('keeps credentials for different platforms independent', async () => {
    const xCreds: AgentCredentials = { ...CREDS, username: 'x-user' }
    await agentCredentialStore.setCredentials(USER, 'reddit', CREDS)
    await agentCredentialStore.setCredentials(USER, 'x', xCreds)

    await expect(agentCredentialStore.getCredentials(USER, 'reddit')).resolves.toEqual(CREDS)
    await expect(agentCredentialStore.getCredentials(USER, 'x')).resolves.toEqual(xCreds)
  })

  it('keeps credentials for different users independent', async () => {
    const otherUser = 'user-2'
    await agentCredentialStore.setCredentials(USER, 'reddit', CREDS)

    await expect(agentCredentialStore.getCredentials(otherUser, 'reddit')).resolves.toBeNull()
  })

  it('overwrites previously stored credentials on re-connect', async () => {
    await agentCredentialStore.setCredentials(USER, 'reddit', CREDS)
    const updated: AgentCredentials = { ...CREDS, password: 'new-password' }
    await agentCredentialStore.setCredentials(USER, 'reddit', updated)

    await expect(agentCredentialStore.getCredentials(USER, 'reddit')).resolves.toEqual(updated)
  })

  it('hasCredentials reflects whether credentials are stored', async () => {
    await expect(agentCredentialStore.hasCredentials(USER, 'reddit')).resolves.toBe(false)
    await agentCredentialStore.setCredentials(USER, 'reddit', CREDS)
    await expect(agentCredentialStore.hasCredentials(USER, 'reddit')).resolves.toBe(true)
  })

  it('deleteCredentials removes stored credentials', async () => {
    await agentCredentialStore.setCredentials(USER, 'reddit', CREDS)
    await agentCredentialStore.deleteCredentials(USER, 'reddit')

    await expect(agentCredentialStore.getCredentials(USER, 'reddit')).resolves.toBeNull()
    await expect(agentCredentialStore.hasCredentials(USER, 'reddit')).resolves.toBe(false)
  })

  it('deleteCredentials is a no-op when nothing was stored', async () => {
    await expect(agentCredentialStore.deleteCredentials(USER, 'reddit')).resolves.toBeUndefined()
  })

  it('_clear() removes all cached credentials for every user', async () => {
    await agentCredentialStore.setCredentials(USER, 'reddit', CREDS)
    agentCredentialStore._clear()

    await expect(agentCredentialStore.getCredentials(USER, 'reddit')).resolves.toBeNull()
  })
})
