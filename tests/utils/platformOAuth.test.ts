// @vitest-environment node
/**
 * Unit tests for the server-side platform OAuth config module (shared-app model).
 * Both client ID and client secret come from <PLATFORM>_CLIENT_ID /
 * <PLATFORM>_CLIENT_SECRET env vars; Instagram reuses the FACEBOOK_* pair.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getPlatformClientId,
  getPlatformClientSecret,
  isPlatformConfigured,
  getPublicOAuthConfig,
  OAUTH_PLATFORMS,
} from '../../server/utils/platformOAuth';

const VARS = [
  'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET',
  'TWITTER_CLIENT_ID', 'TWITTER_CLIENT_SECRET',
  'META_CLIENT_ID', 'META_CLIENT_SECRET',
  'NODE_ENV',
];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of VARS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

describe('getPlatformClientId', () => {
  it('returns the env value for a platform', () => {
    process.env.LINKEDIN_CLIENT_ID = 'li-id';
    expect(getPlatformClientId('linkedin')).toBe('li-id');
  });

  it('returns an empty string when unset', () => {
    expect(getPlatformClientId('linkedin')).toBe('');
  });

  it('trims surrounding whitespace', () => {
    process.env.TWITTER_CLIENT_ID = '  tw-id  ';
    expect(getPlatformClientId('twitter')).toBe('tw-id');
  });

  it('reads Instagram from the META_* var (shared Meta app)', () => {
    process.env.META_CLIENT_ID = 'meta-id';
    expect(getPlatformClientId('instagram')).toBe('meta-id');
  });
});

describe('getPlatformClientSecret', () => {
  it('returns the env secret when set', () => {
    process.env.LINKEDIN_CLIENT_SECRET = 's3cret';
    expect(getPlatformClientSecret('linkedin')).toBe('s3cret');
  });

  it('falls back to a dev placeholder (with a warning) outside production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NODE_ENV = 'development';
    expect(getPlatformClientSecret('linkedin')).toBe('dev-secret-change-in-production');
    expect(warn).toHaveBeenCalled();
  });

  it('throws in production when the secret is missing', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getPlatformClientSecret('linkedin')).toThrow(/not configured/i);
  });

  it('reads Instagram secret from META_CLIENT_SECRET', () => {
    process.env.META_CLIENT_SECRET = 'meta-secret';
    expect(getPlatformClientSecret('instagram')).toBe('meta-secret');
  });
});

describe('isPlatformConfigured', () => {
  it('is true only when both client ID and secret are set', () => {
    process.env.LINKEDIN_CLIENT_ID = 'li-id';
    process.env.LINKEDIN_CLIENT_SECRET = 's3cret';
    expect(isPlatformConfigured('linkedin')).toBe(true);
  });

  it('is false when the client ID is missing', () => {
    process.env.LINKEDIN_CLIENT_SECRET = 's3cret';
    expect(isPlatformConfigured('linkedin')).toBe(false);
  });

  it('is false when only the client ID is set (no real secret)', () => {
    process.env.TWITTER_CLIENT_ID = 'tw-id';
    expect(isPlatformConfigured('twitter')).toBe(false);
  });
});

describe('getPublicOAuthConfig', () => {
  it('includes every supported platform', () => {
    const config = getPublicOAuthConfig();
    for (const platform of OAUTH_PLATFORMS) {
      expect(config).toHaveProperty(platform);
    }
  });

  it('maps platforms to their client IDs and never includes secrets', () => {
    process.env.LINKEDIN_CLIENT_ID = 'li-id';
    process.env.LINKEDIN_CLIENT_SECRET = 'should-not-appear';
    const config = getPublicOAuthConfig();
    expect(config.linkedin).toBe('li-id');
    expect(JSON.stringify(config)).not.toContain('should-not-appear');
  });

  it('mirrors the Meta client ID to Instagram and Facebook', () => {
    process.env.META_CLIENT_ID = 'meta-id';
    const config = getPublicOAuthConfig();
    expect(config.facebook).toBe('meta-id');
    expect(config.instagram).toBe('meta-id');
  });
});
