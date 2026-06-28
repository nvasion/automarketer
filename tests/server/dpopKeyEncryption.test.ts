// @vitest-environment node
/**
 * Unit tests for the DPoP private key at-rest encryption utility.
 *
 * Tests cover:
 *   - Round-trip encrypt → decrypt with a configured key
 *   - Development-mode plain: prefix when no key is set
 *   - Error paths: wrong key, corrupted ciphertext, bad format
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptDPoPKey, decryptDPoPKey } from '../../server/utils/dpopKeyEncryption';

// A deterministic 32-byte test key (base64-encoded).
const TEST_KEY = Buffer.alloc(32, 0xab).toString('base64');

const ORIGINAL_ENV = Object.assign({}, process.env);

beforeEach(() => {
  // Start each test with no encryption key set.
  delete process.env.BLUESKY_DPOP_ENCRYPTION_KEY;
});

afterEach(() => {
  // Restore original env to avoid test bleed.
  Object.assign(process.env, ORIGINAL_ENV);
  if (!ORIGINAL_ENV.BLUESKY_DPOP_ENCRYPTION_KEY) {
    delete process.env.BLUESKY_DPOP_ENCRYPTION_KEY;
  }
});

// ── Development mode (no key set) ─────────────────────────────────────────────

describe('development mode (BLUESKY_DPOP_ENCRYPTION_KEY not set)', () => {
  it('stores plaintext with a "plain:" prefix', () => {
    const plaintext = '{"kty":"EC","crv":"P-256","d":"test"}';
    const stored = encryptDPoPKey(plaintext);
    expect(stored.startsWith('plain:')).toBe(true);
    expect(stored).toBe(`plain:${plaintext}`);
  });

  it('round-trips through plain: encoding', () => {
    const plaintext = '{"kty":"EC","crv":"P-256","d":"secretkey"}';
    const stored = encryptDPoPKey(plaintext);
    const recovered = decryptDPoPKey(stored);
    expect(recovered).toBe(plaintext);
  });

  it('decrypt rejects an encrypted ciphertext when no key is configured', () => {
    // Construct a fake v1 ciphertext to verify the error path.
    const fakeStored = 'v1:aabbcc:ddeeff:001122';
    expect(() => decryptDPoPKey(fakeStored)).toThrow('BLUESKY_DPOP_ENCRYPTION_KEY is required');
  });
});

// ── Encrypted mode (key configured) ───────────────────────────────────────────

describe('encrypted mode (BLUESKY_DPOP_ENCRYPTION_KEY set)', () => {
  beforeEach(() => {
    process.env.BLUESKY_DPOP_ENCRYPTION_KEY = TEST_KEY;
  });

  it('does NOT store the plaintext directly in the encrypted output', () => {
    const plaintext = '{"kty":"EC","crv":"P-256","d":"supersecretprivatekey"}';
    const stored = encryptDPoPKey(plaintext);
    expect(stored).not.toContain('supersecretprivatekey');
  });

  it('produces a v1: prefixed ciphertext string', () => {
    const stored = encryptDPoPKey('{"kty":"EC"}');
    expect(stored.startsWith('v1:')).toBe(true);
    const parts = stored.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
  });

  it('round-trips: decryptDPoPKey(encryptDPoPKey(x)) === x', () => {
    const plaintext = '{"kty":"EC","crv":"P-256","d":"some-private-key","x":"xval","y":"yval"}';
    const stored = encryptDPoPKey(plaintext);
    const recovered = decryptDPoPKey(stored);
    expect(recovered).toBe(plaintext);
  });

  it('produces a different ciphertext on each call (random IV)', () => {
    const plaintext = '{"kty":"EC","crv":"P-256","d":"deterministic-test"}';
    const stored1 = encryptDPoPKey(plaintext);
    const stored2 = encryptDPoPKey(plaintext);
    // Same plaintext but different IV → different ciphertext.
    expect(stored1).not.toBe(stored2);
  });

  it('still decrypts a "plain:" value (backward compat with dev data)', () => {
    const plaintext = '{"kty":"EC","d":"dev-key"}';
    const plainStored = `plain:${plaintext}`;
    const recovered = decryptDPoPKey(plainStored);
    expect(recovered).toBe(plaintext);
  });

  it('throws on corrupted ciphertext (auth tag mismatch)', () => {
    const stored = encryptDPoPKey('{"kty":"EC","d":"real-key"}');
    // Tamper with the last character of the hex ciphertext.
    const tampered = stored.slice(0, -1) + (stored.endsWith('a') ? 'b' : 'a');
    expect(() => decryptDPoPKey(tampered)).toThrow();
  });

  it('throws on an unrecognised format string', () => {
    expect(() => decryptDPoPKey('v99:invalid:format')).toThrow();
  });
});

// ── Key validation ─────────────────────────────────────────────────────────────

describe('BLUESKY_DPOP_ENCRYPTION_KEY validation', () => {
  it('throws when the key decodes to the wrong length', () => {
    // A 16-byte key (too short for AES-256).
    process.env.BLUESKY_DPOP_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    expect(() => encryptDPoPKey('test')).toThrow('32 bytes');
  });
});
