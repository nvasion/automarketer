// @vitest-environment node
/**
 * Unit tests for validatePdsUrl — the SSRF guard applied to PDS URLs extracted
 * from AT Protocol DID documents.
 *
 * A malicious DID document could set `serviceEndpoint` to an internal address
 * (e.g. "http://169.254.169.254/latest/meta-data") and bypass handle-level
 * validation entirely. validatePdsUrl is the last line of defence before any
 * outbound HTTP request is made to the PDS.
 */
import { describe, it, expect } from 'vitest';
import { validatePdsUrl } from '../../server/utils/blueskyOAuth';

// ── Happy paths ───────────────────────────────────────────────────────────────

describe('validatePdsUrl — valid URLs', () => {
  it('accepts the main bsky.social PDS', () => {
    expect(() => validatePdsUrl('https://bsky.social')).not.toThrow();
  });

  it('accepts a custom PDS on a subdomain', () => {
    expect(() => validatePdsUrl('https://pds.example.com')).not.toThrow();
  });

  it('accepts a URL with a trailing slash stripped by getPdsUrl', () => {
    // getPdsUrl strips trailing slashes before calling validatePdsUrl.
    expect(() => validatePdsUrl('https://bsky.social')).not.toThrow();
  });

  it('accepts a deep subdomain PDS', () => {
    expect(() => validatePdsUrl('https://self.hosted.pds.my-domain.io')).not.toThrow();
  });
});

// ── SSRF / injection — all must throw ─────────────────────────────────────────

describe('validatePdsUrl — SSRF rejection', () => {
  it('rejects plain HTTP (non-HTTPS)', () => {
    expect(() => validatePdsUrl('http://bsky.social')).toThrow(/HTTPS/i);
  });

  it('rejects the AWS EC2 metadata IPv4 address', () => {
    expect(() => validatePdsUrl('https://169.254.169.254')).toThrow(/IPv4/i);
  });

  it('rejects a private-range IPv4 address', () => {
    expect(() => validatePdsUrl('https://192.168.1.100')).toThrow(/IPv4/i);
  });

  it('rejects a loopback IPv4 address', () => {
    expect(() => validatePdsUrl('https://127.0.0.1')).toThrow(/IPv4/i);
  });

  it('rejects an IPv6 loopback address', () => {
    // URL representation of ::1 is [::1].
    expect(() => validatePdsUrl('https://[::1]')).toThrow(/IPv6/i);
  });

  it('rejects an IPv6 address in general', () => {
    expect(() => validatePdsUrl('https://[2001:db8::1]')).toThrow(/IPv6/i);
  });

  it('rejects "localhost" (single-label hostname)', () => {
    expect(() => validatePdsUrl('https://localhost')).toThrow(/single-label|two DNS/i);
  });

  it('rejects any other single-label hostname', () => {
    expect(() => validatePdsUrl('https://intranet')).toThrow(/single-label|two DNS/i);
  });

  it('rejects a URL with embedded credentials', () => {
    expect(() => validatePdsUrl('https://user:pass@bsky.social')).toThrow(/credential/i);
  });

  it('rejects a file:// URL', () => {
    expect(() => validatePdsUrl('file:///etc/passwd')).toThrow(/HTTPS/i);
  });

  it('rejects a data: URL', () => {
    expect(() => validatePdsUrl('data:text/plain,hello')).toThrow();
  });

  it('rejects a completely invalid URL string', () => {
    expect(() => validatePdsUrl('not-a-url')).toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => validatePdsUrl('')).toThrow();
  });
});
