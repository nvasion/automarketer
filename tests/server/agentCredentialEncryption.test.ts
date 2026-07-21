// @vitest-environment node
/**
 * Unit tests for the agent credentials at-rest encryption utility.
 *
 * Tests cover:
 *   - Round-trip encrypt → decrypt with a configured key
 *   - Development-mode "plain:" prefix when no key is set
 *   - Error paths: wrong/missing key, corrupted ciphertext, bad format
 *   - The setEncryptionKey/clearEncryptionKey test-injection hooks
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptAgentCredentials,
  decryptAgentCredentials,
  setEncryptionKey,
  clearEncryptionKey,
  type AgentCredentials,
} from '../../server/utils/agentCredentialEncryption';

// A deterministic 32-byte test key (base64-encoded).
const TEST_KEY = Buffer.alloc(32, 0xcd).toString('base64');

const SAMPLE: AgentCredentials = {
  username: 'agent-user',
  password: 'super-secret-password',
  clientId: 'client-id-123',
  clientSecret: 'client-secret-456',
};

const ORIGINAL_ENV = Object.assign({}, process.env);

beforeEach(() => {
  delete process.env.AGENT_CREDENTIALS_ENCRYPTION_KEY;
  clearEncryptionKey();
});

afterEach(() => {
  Object.assign(process.env, ORIGINAL_ENV);
  if (!ORIGINAL_ENV.AGENT_CREDENTIALS_ENCRYPTION_KEY) {
    delete process.env.AGENT_CREDENTIALS_ENCRYPTION_KEY;
  }
  clearEncryptionKey();
});

// ── Development mode (no key set) ─────────────────────────────────────────────

describe('development mode (AGENT_CREDENTIALS_ENCRYPTION_KEY not set)', () => {
  it('stores plaintext JSON with a "plain:" prefix', () => {
    const stored = encryptAgentCredentials(SAMPLE);
    expect(stored.startsWith('plain:')).toBe(true);
    expect(JSON.parse(stored.slice('plain:'.length))).toEqual(SAMPLE);
  });

  it('round-trips through plain: encoding', () => {
    const stored = encryptAgentCredentials(SAMPLE);
    expect(decryptAgentCredentials(stored)).toEqual(SAMPLE);
  });

  it('throws when decrypting a "plain:" value with corrupted JSON', () => {
    expect(() => decryptAgentCredentials('plain:{not-json')).toThrow(
      'Failed to parse plaintext credentials',
    );
  });

  it('decrypt rejects an encrypted ciphertext when no key is configured', () => {
    const fakeStored = 'v1:aabbcc:ddeeff:001122';
    expect(() => decryptAgentCredentials(fakeStored)).toThrow(
      'AGENT_CREDENTIALS_ENCRYPTION_KEY is required',
    );
  });
});

// ── Encrypted mode (key configured via env var) ───────────────────────────────

describe('encrypted mode (AGENT_CREDENTIALS_ENCRYPTION_KEY set)', () => {
  beforeEach(() => {
    process.env.AGENT_CREDENTIALS_ENCRYPTION_KEY = TEST_KEY;
  });

  it('does NOT store any plaintext field directly in the encrypted output', () => {
    const stored = encryptAgentCredentials(SAMPLE);
    expect(stored).not.toContain(SAMPLE.password);
    expect(stored).not.toContain(SAMPLE.clientSecret);
    expect(stored).not.toContain(SAMPLE.username);
  });

  it('produces a v1: prefixed ciphertext string with 4 colon-delimited parts', () => {
    const stored = encryptAgentCredentials(SAMPLE);
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored.split(':')).toHaveLength(4);
  });

  it('round-trips: decryptAgentCredentials(encryptAgentCredentials(x)) === x', () => {
    const stored = encryptAgentCredentials(SAMPLE);
    expect(decryptAgentCredentials(stored)).toEqual(SAMPLE);
  });

  it('produces a different ciphertext on each call (random IV)', () => {
    const stored1 = encryptAgentCredentials(SAMPLE);
    const stored2 = encryptAgentCredentials(SAMPLE);
    expect(stored1).not.toBe(stored2);
  });

  it('still decrypts a "plain:" value (backward compat with dev data)', () => {
    const plainStored = `plain:${JSON.stringify(SAMPLE)}`;
    expect(decryptAgentCredentials(plainStored)).toEqual(SAMPLE);
  });

  it('throws on corrupted ciphertext (auth tag mismatch)', () => {
    const stored = encryptAgentCredentials(SAMPLE);
    const tampered = stored.slice(0, -1) + (stored.endsWith('a') ? 'b' : 'a');
    expect(() => decryptAgentCredentials(tampered)).toThrow('authentication tag mismatch');
  });

  it('throws on an unrecognised format string', () => {
    expect(() => decryptAgentCredentials('v99:invalid:format')).toThrow(
      'Unrecognised credentials ciphertext format',
    );
  });

  it('throws when decrypting with a different key than it was encrypted with', () => {
    const stored = encryptAgentCredentials(SAMPLE);
    process.env.AGENT_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 0xef).toString('base64');
    expect(() => decryptAgentCredentials(stored)).toThrow();
  });
});

// ── Key validation ─────────────────────────────────────────────────────────────

describe('AGENT_CREDENTIALS_ENCRYPTION_KEY validation', () => {
  it('throws when the env key decodes to the wrong length', () => {
    process.env.AGENT_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    expect(() => encryptAgentCredentials(SAMPLE)).toThrow('32 bytes');
  });

  it('setEncryptionKey throws when the injected key is the wrong length', () => {
    expect(() => setEncryptionKey(Buffer.alloc(10))).toThrow('32 bytes');
  });
});

// ── Test-injection hooks (setEncryptionKey / clearEncryptionKey) ──────────────

describe('setEncryptionKey / clearEncryptionKey', () => {
  it('uses an injected key over the environment variable', () => {
    process.env.AGENT_CREDENTIALS_ENCRYPTION_KEY = TEST_KEY;
    setEncryptionKey(Buffer.alloc(32, 0x11));

    const stored = encryptAgentCredentials(SAMPLE);
    // Decrypting with the injected key (still set) must succeed.
    expect(decryptAgentCredentials(stored)).toEqual(SAMPLE);

    // Decrypting with only the env var key (after clearing the override) must fail,
    // proving the injected key — not the env var — was actually used.
    clearEncryptionKey();
    expect(() => decryptAgentCredentials(stored)).toThrow();
  });

  it('reverts to environment variable lookup after clearEncryptionKey', () => {
    setEncryptionKey(Buffer.alloc(32, 0x22));
    clearEncryptionKey();

    // No env var and no override → development plain: mode.
    const stored = encryptAgentCredentials(SAMPLE);
    expect(stored.startsWith('plain:')).toBe(true);
  });
});
