import { Pool } from 'pg';
import type { PoolConfig } from 'pg';

// Lazily-created singleton pool. Returns null when DATABASE_URL is not set
// so the server can start (and tests can run) without a live database.
let _pool: Pool | null = null;

/**
 * Resolves the TLS configuration for the connection pool.
 *
 * Managed Postgres providers (DigitalOcean, etc.) require TLS, but their CA is
 * usually not in the system trust store, so a bare `connectionString` connects
 * without SSL and fails. This derives a sensible `ssl` option from the
 * environment:
 *
 *   - DATABASE_SSL=false        → no TLS (local/docker Postgres that lacks it).
 *   - production, or DATABASE_SSL=true:
 *       - DATABASE_CA_CERT set   → verify the server against that CA (secure).
 *       - otherwise              → encrypted but unverified (what managed
 *                                  providers require without their CA bundle).
 *   - anything else (dev/test)  → no TLS.
 *
 * Exported for unit testing.
 */
export function resolveSslConfig(): PoolConfig['ssl'] {
  if (process.env.DATABASE_SSL === 'false') return undefined;

  const sslRequired =
    process.env.DATABASE_SSL === 'true' || process.env.NODE_ENV === 'production';
  if (!sslRequired) return undefined;

  const ca = process.env.DATABASE_CA_CERT;
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

/**
 * Removes the libpq SSL params (`sslmode`, `ssl`) from a connection string.
 *
 * DigitalOcean appends `?sslmode=require` to DATABASE_URL. Newer
 * pg-connection-string treats `require` as `verify-full`, which rejects the
 * managed database's CA chain ("self-signed certificate in certificate chain").
 * When we configure TLS ourselves via resolveSslConfig(), the URL-level mode
 * must not override it — so strip it before handing the string to pg.
 *
 * Exported for unit testing.
 */
export function stripSslParams(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    url.searchParams.delete('ssl');
    return url.toString();
  } catch {
    // Fallback for any string new URL() can't parse: drop the params textually.
    return connectionString
      .replace(/([?&])(sslmode|ssl)=[^&]*/gi, '$1')
      .replace(/([?&])&+/g, '$1')
      .replace(/[?&]$/, '');
  }
}

/**
 * Returns the shared pg connection pool, or null if DATABASE_URL is not
 * configured. All callers must handle the null case gracefully so the server
 * operates in a degraded (env-var-only) mode when no database is available.
 *
 * Pool creation errors are caught and re-thrown with a sanitised message so
 * that the raw DATABASE_URL (which may include credentials) is never written
 * to logs or surfaced in error responses.
 */
export function getPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  if (!_pool) {
    try {
      const ssl = resolveSslConfig();
      // When we manage TLS ourselves, strip the URL's sslmode so it doesn't
      // override our ssl config (see stripSslParams). Otherwise leave the
      // string untouched (local/no-TLS Postgres).
      const connectionString = ssl
        ? stripSslParams(process.env.DATABASE_URL)
        : process.env.DATABASE_URL;
      _pool = new Pool({ connectionString, ssl });

      // Handle unexpected pool-level errors (e.g. abrupt connection drops).
      // Log a generic message — never log the connection string or error details
      // that could contain credentials.
      _pool.on('error', (_err: Error) => {
        console.error('[db] Unexpected pool error — check database connectivity.');
      });
    } catch {
      // Re-throw without including the original message which may contain the
      // DATABASE_URL value (username, password, hostname).
      throw new Error(
        '[db] Failed to create database connection pool. ' +
          'Verify that DATABASE_URL is a valid PostgreSQL connection string.',
      );
    }
  }
  return _pool;
}

/**
 * Tear down the pool connection. Used in graceful shutdown and integration
 * tests that need a clean state between runs.
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
