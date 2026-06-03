// ── Platform-specific OAuth and credential configuration ──────────────────────
// Centralised here so the UI component stays decoupled from platform details.

export interface CredentialField {
  key: string
  label: string
  placeholder: string
  type?: 'text' | 'password'
  /** Returns a non-empty error string when the value is invalid, or null if valid. */
  validate?: (value: string) => string | null
}

export interface PlatformOAuthConfig {
  /** Button label, e.g. "Sign in with LinkedIn" */
  label: string
  /** Canonical short marketing name, e.g. "X" (not "X (Twitter)") */
  shortName: string
  /**
   * OAuth 2.0 authorization endpoint.
   * In production, replace {CLIENT_ID}, {REDIRECT_URI}, and {STATE} with your
   * registered app values — these are placeholder URLs for the demo build.
   *
   * {STATE} is a cryptographically random value generated at runtime to
   * prevent CSRF attacks (RFC 6749 §10.12).
   */
  authUrl: string
}

// ── Per-platform credential field definitions with format validation ───────────

export const PLATFORM_CREDENTIAL_FIELDS: Record<string, CredentialField[]> = {
  linkedin: [
    {
      key: 'accessToken',
      label: 'Access Token',
      placeholder: 'AQX…',
      type: 'password',
      validate: (v) =>
        v.length < 20 ? 'Access token appears too short (expected 20+ characters).' : null,
    },
  ],
  twitter: [
    {
      key: 'apiKey',
      label: 'API Key',
      placeholder: 'Enter your API key',
      type: 'password',
      validate: (v) =>
        !/^[A-Za-z0-9]{10,}$/.test(v)
          ? 'API Key should be alphanumeric and at least 10 characters.'
          : null,
    },
    {
      key: 'apiSecret',
      label: 'API Secret',
      placeholder: 'Enter your API secret',
      type: 'password',
      validate: (v) =>
        v.length < 20 ? 'API Secret appears too short (expected 20+ characters).' : null,
    },
    {
      key: 'accessToken',
      label: 'Access Token',
      placeholder: 'Enter your access token',
      type: 'password',
      validate: (v) =>
        !/^\d+-[A-Za-z0-9]+$/.test(v)
          ? 'Access Token format is invalid (expected: digits-alphanumeric).'
          : null,
    },
    {
      key: 'accessTokenSecret',
      label: 'Access Token Secret',
      placeholder: 'Enter your access token secret',
      type: 'password',
      validate: (v) =>
        v.length < 20
          ? 'Access Token Secret appears too short (expected 20+ characters).'
          : null,
    },
  ],
  reddit: [
    {
      key: 'clientId',
      label: 'Client ID',
      placeholder: 'Enter your app client ID',
      validate: (v) =>
        v.length < 10 ? 'Client ID appears too short (expected 10+ characters).' : null,
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      placeholder: 'Enter your app client secret',
      type: 'password',
      validate: (v) =>
        v.length < 20 ? 'Client Secret appears too short (expected 20+ characters).' : null,
    },
  ],
  facebook: [
    {
      key: 'accessToken',
      label: 'Page Access Token',
      placeholder: 'EAAx…',
      type: 'password',
      validate: (v) =>
        !/^EAAX/i.test(v) ? 'Page Access Token should start with "EAAx".' : null,
    },
  ],
  instagram: [
    {
      key: 'accessToken',
      label: 'Access Token',
      placeholder: 'EAAx…',
      type: 'password',
      validate: (v) =>
        !/^EAAX/i.test(v) ? 'Access Token should start with "EAAx".' : null,
    },
  ],
}

// ── OAuth configuration per platform ──────────────────────────────────────────

export const PLATFORM_OAUTH_CONFIG: Record<string, PlatformOAuthConfig> = {
  linkedin: {
    label: 'Sign in with LinkedIn',
    shortName: 'LinkedIn',
    authUrl:
      'https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=openid%20profile%20email%20w_member_social&state={STATE}',
  },
  twitter: {
    label: 'Sign in with X',
    shortName: 'X',
    authUrl:
      'https://twitter.com/i/oauth2/authorize?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=tweet.read%20tweet.write%20users.read%20offline.access&code_challenge_method=s256&state={STATE}',
  },
  reddit: {
    label: 'Sign in with Reddit',
    shortName: 'Reddit',
    authUrl:
      'https://www.reddit.com/api/v1/authorize?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=read%20submit&duration=permanent&state={STATE}',
  },
  facebook: {
    label: 'Sign in with Facebook',
    shortName: 'Facebook',
    authUrl:
      'https://www.facebook.com/v18.0/dialog/oauth?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=pages_manage_posts%2Cpages_read_engagement&state={STATE}',
  },
  instagram: {
    label: 'Sign in with Instagram',
    shortName: 'Instagram',
    authUrl:
      'https://api.instagram.com/oauth/authorize?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=user_profile%2Cuser_media&state={STATE}',
  },
}
