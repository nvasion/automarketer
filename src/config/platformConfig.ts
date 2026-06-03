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
   * OAuth 2.0 authorization endpoint template.
   * At runtime the following placeholders are substituted before the popup opens:
   *   {CLIENT_ID}      — value of `clientId` (from the VITE_*_CLIENT_ID env var)
   *   {REDIRECT_URI}   — URL-encoded `<origin>/oauth/callback`
   *   {STATE}          — cryptographically random CSRF token (RFC 6749 §10.12)
   *   {CODE_CHALLENGE} — PKCE S256 challenge derived from a random verifier (RFC 7636)
   */
  authUrl: string
  /**
   * OAuth 2.0 client ID for this platform.
   * Read from the corresponding VITE_*_CLIENT_ID environment variable so the
   * value is baked into the client bundle at build time without exposing secrets
   * (client IDs are public; client secrets must never be stored here).
   */
  clientId: string
  /**
   * Name of the VITE_* environment variable that supplies `clientId`.
   * Used in developer-facing error messages when the value is missing.
   */
  envVarName: string
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
    clientId: import.meta.env.VITE_LINKEDIN_CLIENT_ID ?? '',
    envVarName: 'VITE_LINKEDIN_CLIENT_ID',
    authUrl:
      'https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=openid%20profile%20email%20w_member_social&state={STATE}',
  },
  twitter: {
    label: 'Sign in with X',
    shortName: 'X',
    clientId: import.meta.env.VITE_TWITTER_CLIENT_ID ?? '',
    envVarName: 'VITE_TWITTER_CLIENT_ID',
    // Twitter/X OAuth 2.0 requires PKCE (RFC 7636).  {CODE_CHALLENGE} is
    // replaced at runtime with a BASE64URL(SHA-256(code_verifier)) value.
    authUrl:
      'https://twitter.com/i/oauth2/authorize?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=tweet.read%20tweet.write%20users.read%20offline.access&code_challenge={CODE_CHALLENGE}&code_challenge_method=s256&state={STATE}',
  },
  reddit: {
    label: 'Sign in with Reddit',
    shortName: 'Reddit',
    clientId: import.meta.env.VITE_REDDIT_CLIENT_ID ?? '',
    envVarName: 'VITE_REDDIT_CLIENT_ID',
    authUrl:
      'https://www.reddit.com/api/v1/authorize?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=read%20submit&duration=permanent&state={STATE}',
  },
  facebook: {
    label: 'Sign in with Facebook',
    shortName: 'Facebook',
    clientId: import.meta.env.VITE_FACEBOOK_APP_ID ?? '',
    envVarName: 'VITE_FACEBOOK_APP_ID',
    authUrl:
      'https://www.facebook.com/v18.0/dialog/oauth?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=pages_manage_posts%2Cpages_read_engagement&state={STATE}',
  },
  instagram: {
    label: 'Sign in with Instagram',
    shortName: 'Instagram',
    // Instagram Graph API access is gated behind Meta's standard OAuth dialog
    // using the same Meta App ID as Facebook.  The legacy Basic Display API
    // endpoint (api.instagram.com/oauth/authorize) was removed in Dec 2024.
    clientId: import.meta.env.VITE_FACEBOOK_APP_ID ?? '',
    envVarName: 'VITE_FACEBOOK_APP_ID',
    authUrl:
      'https://www.facebook.com/v18.0/dialog/oauth?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=instagram_basic%2Cinstagram_content_publish%2Cpages_show_list%2Cpages_read_engagement&state={STATE}',
  },
}
