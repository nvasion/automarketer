const DEV_FALLBACK_SECRET = 'dev-secret-change-in-production';

/**
 * Returns the JWT signing secret.
 *
 * - In production: throws if JWT_SECRET is not set.
 * - In development/test: falls back to a hardcoded insecure default and
 *   emits a console warning so developers notice immediately.
 */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_SECRET environment variable is required in production. ' +
          'Generate one with: openssl rand -hex 64',
      );
    }
    console.warn(
      '[auth] JWT_SECRET is not set — using an insecure dev default. ' +
        'Set JWT_SECRET in your .env file before going to production.',
    );
    return DEV_FALLBACK_SECRET;
  }
  return secret;
}
