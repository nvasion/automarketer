// @vitest-environment node
/**
 * Unit tests for the Bluesky route input validators.
 *
 * isValidBlueskyHandle — guards against SSRF via malicious handle values.
 * isValidOAuthState    — enforces minimum entropy for the CSRF state token.
 */
import { describe, it, expect } from 'vitest';
import { isValidBlueskyHandle, isValidOAuthState } from '../../server/routes/bluesky';

// ── isValidBlueskyHandle ──────────────────────────────────────────────────────

describe('isValidBlueskyHandle', () => {
  // Happy paths
  it('accepts a standard bsky.social handle', () => {
    expect(isValidBlueskyHandle('alice.bsky.social')).toBe(true);
  });

  it('accepts a handle with a leading "@"', () => {
    expect(isValidBlueskyHandle('@alice.bsky.social')).toBe(true);
  });

  it('accepts handles with hyphens in labels', () => {
    expect(isValidBlueskyHandle('alice-smith.bsky.social')).toBe(true);
  });

  it('accepts handles with multiple sub-domains', () => {
    expect(isValidBlueskyHandle('user.sub.custom.pds.example.com')).toBe(true);
  });

  it('accepts upper-case handles (normalised by the validator)', () => {
    expect(isValidBlueskyHandle('Alice.BSKY.Social')).toBe(true);
  });

  it('strips whitespace before validating', () => {
    expect(isValidBlueskyHandle('  alice.bsky.social  ')).toBe(true);
  });

  // SSRF / injection guard — these must ALL be rejected

  it('rejects a bare localhost (single-label)', () => {
    expect(isValidBlueskyHandle('localhost')).toBe(false);
  });

  it('rejects a localhost with port (not a valid hostname)', () => {
    expect(isValidBlueskyHandle('localhost:8080')).toBe(false);
  });

  it('rejects an IPv4 address', () => {
    expect(isValidBlueskyHandle('192.168.1.1')).toBe(false);
  });

  it('rejects the AWS metadata IP', () => {
    expect(isValidBlueskyHandle('169.254.169.254')).toBe(false);
  });

  it('rejects handles with path components', () => {
    expect(isValidBlueskyHandle('alice.bsky.social/evil')).toBe(false);
  });

  it('rejects handles with a protocol prefix', () => {
    expect(isValidBlueskyHandle('https://alice.bsky.social')).toBe(false);
  });

  it('rejects handles with URL-encoded characters', () => {
    expect(isValidBlueskyHandle('alice%40bsky.social')).toBe(false);
  });

  it('rejects labels starting with a hyphen', () => {
    expect(isValidBlueskyHandle('-alice.bsky.social')).toBe(false);
  });

  it('rejects labels ending with a hyphen', () => {
    expect(isValidBlueskyHandle('alice-.bsky.social')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidBlueskyHandle('')).toBe(false);
  });

  it('rejects a bare "@"', () => {
    expect(isValidBlueskyHandle('@')).toBe(false);
  });
});

// ── isValidOAuthState ─────────────────────────────────────────────────────────

describe('isValidOAuthState', () => {
  const VALID_STATE = 'a'.repeat(32);

  it('accepts a 32-character alphanumeric string', () => {
    expect(isValidOAuthState(VALID_STATE)).toBe(true);
  });

  it('accepts a 64-character state token', () => {
    expect(isValidOAuthState('a'.repeat(64))).toBe(true);
  });

  it('accepts a state with hyphens and underscores', () => {
    expect(isValidOAuthState('aB3-cD4_eF5-gH6_iJ7-kL8_mN9-oP0_qR1')).toBe(true);
  });

  it('accepts a URL-safe base64 encoded 32-byte random value', () => {
    // This simulates crypto.randomBytes(32).toString('base64url').
    const state = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef01'; // 34 URL-safe chars
    expect(isValidOAuthState(state)).toBe(true);
  });

  // Rejection cases

  it('rejects a state shorter than 32 characters', () => {
    expect(isValidOAuthState('short')).toBe(false);
    expect(isValidOAuthState('a'.repeat(31))).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidOAuthState('')).toBe(false);
  });

  it('rejects a state with spaces', () => {
    expect(isValidOAuthState('a'.repeat(16) + ' ' + 'a'.repeat(15))).toBe(false);
  });

  it('rejects a state with plus signs (non-URL-safe base64)', () => {
    expect(isValidOAuthState('a'.repeat(30) + '+=')).toBe(false);
  });

  it('rejects a state with slash characters', () => {
    expect(isValidOAuthState('a'.repeat(30) + '//')).toBe(false);
  });

  it('rejects a state with special characters', () => {
    expect(isValidOAuthState('a'.repeat(30) + '!@')).toBe(false);
  });
});
