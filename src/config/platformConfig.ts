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

export interface PlatformSetupInstructions {
  /** Link to the developer portal where the OAuth app is created. */
  portalUrl: string
  /** Human-readable name of the developer portal. */
  portalName: string
  /**
   * Step-by-step instructions for creating the OAuth app.
   * Use the literal string {REDIRECT_URI} as a placeholder — the component
   * replaces it with the actual `<origin>/oauth/callback` value at render time.
   *
   * The final step is always "paste the Client ID into the form below" — it
   * is rendered by the SetupInstructions component itself rather than being
   * listed here, so this array should end at the "copy the Client ID" step.
   */
  steps: string[]
}

export interface PlatformOAuthConfig {
  /** Button label, e.g. "Sign in with LinkedIn" */
  label: string
  /** Canonical short marketing name, e.g. "X" (not "X (Twitter)") */
  shortName: string
  /**
   * OAuth 2.0 authorization endpoint template.
   * At runtime the following placeholders are substituted before the popup opens:
   *   {CLIENT_ID}      — the client ID fetched from GET /api/platform-config
   *   {REDIRECT_URI}   — URL-encoded `<origin>/oauth/callback`
   *   {STATE}          — cryptographically random CSRF token (RFC 6749 §10.12)
   *   {CODE_CHALLENGE} — PKCE S256 challenge derived from a random verifier (RFC 7636)
   */
  authUrl: string
  /** Step-by-step guide shown when the client ID has not been configured yet. */
  setupInstructions: PlatformSetupInstructions
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
    setupInstructions: {
      portalUrl: 'https://www.linkedin.com/developers/apps',
      portalName: 'LinkedIn Developer Portal',
      steps: [
        'Go to the LinkedIn Developer Portal and click "Create app".',
        'Under the "Auth" tab, add {REDIRECT_URI} as an Authorized Redirect URL.',
        'Under the "Products" tab, request "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect".',
        'Copy the Client ID from the "Auth" tab.',
      ],
    },
  },
  twitter: {
    label: 'Sign in with X',
    shortName: 'X',
    // Twitter/X OAuth 2.0 requires PKCE (RFC 7636).  {CODE_CHALLENGE} is
    // replaced at runtime with a BASE64URL(SHA-256(code_verifier)) value.
    authUrl:
      'https://twitter.com/i/oauth2/authorize?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=tweet.read%20tweet.write%20users.read%20offline.access&code_challenge={CODE_CHALLENGE}&code_challenge_method=s256&state={STATE}',
    setupInstructions: {
      portalUrl: 'https://developer.twitter.com/en/portal/dashboard',
      portalName: 'X Developer Portal',
      steps: [
        'Go to the X Developer Portal and create a project and app.',
        'Under "User authentication settings", enable OAuth 2.0.',
        'Set App type to "Web App, Automated App or Bot".',
        'Add {REDIRECT_URI} as a Callback URI.',
        'Enable scopes: tweet.read, tweet.write, users.read, offline.access.',
        'Copy the OAuth 2.0 Client ID (not the API Key / API Key Secret).',
      ],
    },
  },
  reddit: {
    label: 'Sign in with Reddit',
    shortName: 'Reddit',
    authUrl:
      'https://www.reddit.com/api/v1/authorize?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=read%20submit&duration=permanent&state={STATE}',
    setupInstructions: {
      portalUrl: 'https://www.reddit.com/prefs/apps',
      portalName: 'Reddit App Preferences',
      steps: [
        'Go to Reddit App Preferences and click "create another app".',
        'Select app type "web app".',
        'Set the redirect URI to {REDIRECT_URI}.',
        'After creating, copy the Client ID — it\'s the short string shown directly below the app name.',
      ],
    },
  },
  facebook: {
    label: 'Sign in with Facebook',
    shortName: 'Facebook',
    authUrl:
      'https://www.facebook.com/v18.0/dialog/oauth?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=pages_manage_posts%2Cpages_read_engagement&state={STATE}',
    setupInstructions: {
      portalUrl: 'https://developers.facebook.com/apps',
      portalName: 'Meta for Developers',
      steps: [
        'Go to Meta for Developers and click "Create App".',
        'Add the "Facebook Login" product to your app.',
        'Under Facebook Login → Settings, add {REDIRECT_URI} as a Valid OAuth Redirect URI.',
        'Request the pages_manage_posts and pages_read_engagement permissions.',
        'Copy the App ID from the top of the app dashboard.',
      ],
    },
  },
  instagram: {
    label: 'Sign in with Instagram',
    shortName: 'Instagram',
    // Instagram Graph API access is gated behind Meta's standard OAuth dialog
    // using the same Meta App ID as Facebook.  The legacy Basic Display API
    // endpoint (api.instagram.com/oauth/authorize) was removed in Dec 2024.
    authUrl:
      'https://www.facebook.com/v18.0/dialog/oauth?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=instagram_basic%2Cinstagram_content_publish%2Cpages_show_list%2Cpages_read_engagement&state={STATE}',
    setupInstructions: {
      portalUrl: 'https://developers.facebook.com/apps',
      portalName: 'Meta for Developers',
      steps: [
        'Go to Meta for Developers and create an app (or use your existing Facebook app — they share the same App ID).',
        'Add the "Instagram Graph API" product to your app.',
        'Under Instagram → Settings, add {REDIRECT_URI} as a Valid OAuth Redirect URI.',
        'Request instagram_basic and instagram_content_publish permissions.',
        'Copy the App ID from the top of the app dashboard.',
        'Note: Instagram and Facebook share the same Meta App ID — saving one fills in the other automatically.',
      ],
    },
  },
}
