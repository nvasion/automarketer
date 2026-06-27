/**
 * Tests for resolveSslConfig — the TLS config derivation for the pg Pool.
 *
 * Runs in the Node environment (see vitest.config.ts) so it imports the real
 * server module. Each test restores the env vars it touches so they don't leak.
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterEach } from 'vitest';
import { resolveSslConfig } from '../../server/db/connection';

const ENV_KEYS = ['DATABASE_SSL', 'NODE_ENV', 'DATABASE_CA_CERT'] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('resolveSslConfig', () => {
  it('returns undefined in development (no TLS)', () => {
    process.env.NODE_ENV = 'development';
    expect(resolveSslConfig()).toBeUndefined();
  });

  it('enables encrypted-but-unverified TLS in production', () => {
    process.env.NODE_ENV = 'production';
    expect(resolveSslConfig()).toEqual({ rejectUnauthorized: false });
  });

  it('opts out of TLS when DATABASE_SSL=false, even in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_SSL = 'false';
    expect(resolveSslConfig()).toBeUndefined();
  });

  it('enables TLS when DATABASE_SSL=true outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_SSL = 'true';
    expect(resolveSslConfig()).toEqual({ rejectUnauthorized: false });
  });

  it('verifies against a CA certificate when DATABASE_CA_CERT is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_CA_CERT = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----';
    expect(resolveSslConfig()).toEqual({
      ca: process.env.DATABASE_CA_CERT,
      rejectUnauthorized: true,
    });
  });
});
