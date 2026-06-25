// @vitest-environment node
/**
 * Unit tests for the OAuth redirect URI derivation.
 *
 * The redirect URI must be identical at authorize time (browser) and token-
 * exchange time (server), and must match what's registered in the provider's
 * dashboard. It is derived as `<FRONTEND_URL>/oauth/callback`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getRedirectUri } from '../../server/routes/oauthCallback';

let savedFrontendUrl: string | undefined;

beforeEach(() => {
  savedFrontendUrl = process.env.FRONTEND_URL;
});

afterEach(() => {
  if (savedFrontendUrl === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = savedFrontendUrl;
});

describe('getRedirectUri', () => {
  it('defaults to the local dev origin when FRONTEND_URL is unset', () => {
    delete process.env.FRONTEND_URL;
    expect(getRedirectUri()).toBe('http://localhost:5173/oauth/callback');
  });

  it('uses FRONTEND_URL as the base', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    expect(getRedirectUri()).toBe('https://app.example.com/oauth/callback');
  });

  it('strips a trailing slash so the URI does not double up', () => {
    process.env.FRONTEND_URL = 'http://localhost:5173/';
    expect(getRedirectUri()).toBe('http://localhost:5173/oauth/callback');
  });

  it('strips multiple trailing slashes', () => {
    process.env.FRONTEND_URL = 'https://app.example.com///';
    expect(getRedirectUri()).toBe('https://app.example.com/oauth/callback');
  });
});
