import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth.js';
import { jwtSecret } from '../utils/config.js';
import { getPool } from '../db/connection.js';
import { encryptAgentCredentials, decryptAgentCredentials } from '../utils/agentCredentialEncryption.js';
import {
  ensureTable,
  insertCredentials,
  findByUserAndPlatform,
  deleteByUserAndPlatform,
  updateCredentials,
} from '../db/agentCredentialsTable.js';
import type { AgentCredentials, PlatformType, CredentialValidationResult } from '../types/agentAuth.js';
import { isPlatformType } from '../types/agentAuth.js';

// ── Constants ─────────────────────────────────────────────────────────────────

// Agent session tokens are shorter-lived than the primary app session (7d,
// see routes/auth.ts) because they represent an elevated capability — the
// ability to act as the user's connected Reddit/X agent — so a compromised
// cookie has a smaller blast-radius window.
const AGENT_SESSION_TTL = '1h';
const AGENT_SESSION_COOKIE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// Per-platform module specifiers for the dynamically-loaded validator
// services (owned by other in-flight tasks). Resolved through a variable
// (rather than a string literal passed directly to `import()`) so the
// TypeScript compiler treats the specifier as untyped `string` and does not
// attempt to statically resolve the module — these services are developed on
// separate branches and may not exist yet in every checkout.
const PLATFORM_SERVICE_MODULES: Record<PlatformType, string> = {
  reddit: '../services/social/redditAgentService.js',
  x: '../services/social/xAgentService.js',
};

// ── Input validators ─────────────────────────────────────────────────────────

/**
 * Validates that a value is a valid platform type. Accepts `unknown` so
 * callers can pass raw `req.body`/`req.params` values (which may be
 * `string | string[] | undefined` under Express 5's param typing) without an
 * unsound cast that would defeat the type-narrowing this guard provides.
 */
function isValidPlatform(value: unknown): value is PlatformType {
  return typeof value === 'string' && isPlatformType(value);
}

/**
 * Human-readable label for a platform, used in user-facing error/status
 * messages. Extracted to avoid repeating the same ternary across handlers.
 */
function platformLabel(platform: PlatformType): string {
  return platform === 'reddit' ? 'Reddit' : 'X (Twitter)';
}

/**
 * Validates that a value is a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates agent credentials structure and returns normalized credentials or error.
 * Extracted to avoid duplication across /connect and /validate endpoints.
 */
function validateAgentCredentialsInput(credentials: unknown): CredentialValidationResult {
  if (!credentials || typeof credentials !== 'object') {
    return {
      valid: false,
      error: 'Credentials object is required',
      code: 'INVALID_CREDENTIALS',
    };
  }

  const creds = credentials as Record<string, unknown>;
  
  if (!isNonEmptyString(creds.username)) {
    return {
      valid: false,
      error: 'Username is required',
      code: 'MISSING_USERNAME',
    };
  }

  if (!isNonEmptyString(creds.password)) {
    return {
      valid: false,
      error: 'Password is required',
      code: 'MISSING_PASSWORD',
    };
  }

  if (!isNonEmptyString(creds.clientId)) {
    return {
      valid: false,
      error: 'Client ID is required',
      code: 'MISSING_CLIENT_ID',
    };
  }

  if (!isNonEmptyString(creds.clientSecret)) {
    return {
      valid: false,
      error: 'Client Secret is required',
      code: 'MISSING_CLIENT_SECRET',
    };
  }

  // Return normalized credentials
  return {
    valid: true,
    credentials: {
      username: creds.username.trim(),
      password: creds.password,
      clientId: creds.clientId.trim(),
      clientSecret: creds.clientSecret.trim(),
    },
  };
}

/**
 * Validates userId from auth middleware to prevent invalid/malicious IDs.
 */
function isValidUserId(userId: unknown): userId is string {
  return isNonEmptyString(userId) && userId.length <= 256;
}

// ── Platform validation factory ──────────────────────────────────────────────

/**
 * Interface for platform validator functions.
 */
interface PlatformValidator {
  validateCredentials(credentials: AgentCredentials): Promise<boolean>;
}

/**
 * Registry of platform validators loaded dynamically.
 * This decouples the routes from concrete service implementations.
 */
class PlatformValidatorRegistry {
  private cache: Map<PlatformType, PlatformValidator> = new Map();

  /**
   * Get or load a platform validator.
   * Returns null if the platform service is not available.
   */
  async getValidator(platform: PlatformType): Promise<PlatformValidator | null> {
    // Check cache first
    const cached = this.cache.get(platform);
    if (cached) {
      return cached;
    }

    try {
      const modulePath = PLATFORM_SERVICE_MODULES[platform];
      const agentModule: unknown = await import(modulePath);

      // Type guard to ensure the module has the expected function
      if (
        !agentModule ||
        typeof agentModule !== 'object' ||
        !('validateCredentials' in agentModule) ||
        typeof (agentModule as { validateCredentials?: unknown }).validateCredentials !== 'function'
      ) {
        return null;
      }

      const validateCredentials = (
        agentModule as { validateCredentials: (credentials: AgentCredentials) => Promise<boolean> }
      ).validateCredentials.bind(agentModule);

      const validator: PlatformValidator = { validateCredentials };

      // Cache the validator
      this.cache.set(platform, validator);
      return validator;
    } catch {
      // Module loading failed - service not available
      return null;
    }
  }

  /**
   * Clear the cache (useful for testing).
   */
  clear(): void {
    this.cache.clear();
  }
}

// Single instance of the registry
const validatorRegistry = new PlatformValidatorRegistry();

// ── Credential persistence ───────────────────────────────────────────────────

/**
 * Encrypt and persist agent credentials for a user/platform pair, updating
 * an existing row when one already exists. Shared by /connect and /login so
 * the insert-or-update logic lives in exactly one place.
 */
async function persistEncryptedCredentials(
  pool: Pool,
  userId: string,
  platform: PlatformType,
  credentials: AgentCredentials,
): Promise<void> {
  await ensureTable(pool);

  const encryptedCredentials = encryptAgentCredentials(credentials);
  const existing = await findByUserAndPlatform(pool, userId, platform);

  if (existing) {
    await updateCredentials(pool, userId, platform, encryptedCredentials);
  } else {
    await insertCredentials(pool, userId, platform, encryptedCredentials);
  }
}

// ── Agent session cookie ─────────────────────────────────────────────────────

/**
 * Payload embedded in the agent session cookie issued by POST /login.
 * Deliberately minimal — it only asserts which app user is acting as which
 * platform's agent; it never carries the underlying platform credentials.
 */
interface AgentSessionPayload {
  sub: string; // app user id
  platform: PlatformType;
}

function agentSessionCookieName(platform: PlatformType): string {
  return `agent_session_${platform}`;
}

function agentSessionCookieOptions() {
  return {
    httpOnly: true, // inaccessible to JS — mitigates XSS token theft
    secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
    sameSite: 'strict' as const, // CSRF protection
    path: '/',
    maxAge: AGENT_SESSION_COOKIE_MAX_AGE_MS,
  };
}

function signAgentSessionToken(userId: string, platform: PlatformType): string {
  const payload: AgentSessionPayload = { sub: userId, platform };
  return jwt.sign(payload, jwtSecret(), {
    algorithm: 'HS256',
    expiresIn: AGENT_SESSION_TTL,
  });
}

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router();

// All agent auth routes require authentication
router.use(requireAuth);

/**
 * POST /api/agent/connect
 * Store encrypted credentials for a platform.
 * 
 * Body: { platform: 'reddit' | 'x'; credentials: { username: string; password: string; clientId: string; clientSecret: string } }
 * Response: { success: true; message: string }
 */
router.post('/connect', async (req: Request, res: Response): Promise<void> => {
  try {
    const { platform, credentials } = req.body as Record<string, unknown>;

    // Validate platform
    if (!isValidPlatform(platform)) {
      res.status(400).json({
        error: 'Invalid platform. Must be one of: reddit, x',
        code: 'INVALID_PLATFORM',
      });
      return;
    }

    // Validate credentials using shared validator
    const validationResult = validateAgentCredentialsInput(credentials);
    if (!validationResult.valid) {
      res.status(400).json({
        error: validationResult.error,
        code: validationResult.code,
      });
      return;
    }

    const userId = req.user!.sub;

    // Validate userId to prevent invalid/malicious IDs
    if (!isValidUserId(userId)) {
      res.status(401).json({
        error: 'Invalid user authentication',
        code: 'INVALID_USER',
      });
      return;
    }

    const pool = getPool();

    if (!pool) {
      res.status(503).json({
        error: 'Database connection not available',
        code: 'DB_UNAVAILABLE',
      });
      return;
    }

    await persistEncryptedCredentials(pool, userId, platform, validationResult.credentials!);

    res.status(200).json({
      success: true,
      message: `Successfully connected to ${platform}`,
    });
  } catch (error) {
    console.error('[agentAuth] Error connecting credentials:', error);
    res.status(500).json({
      error: 'Failed to store credentials',
      code: 'STORE_ERROR',
    });
  }
});

/**
 * POST /api/agent/login
 * Authenticate a platform agent: validates the submitted credentials
 * (structurally, and against the live platform when its validator service is
 * available), stores them encrypted in the database, and — on success —
 * issues an httpOnly session cookie asserting that this app user is
 * authenticated as that platform's agent.
 *
 * Body: { platform: 'reddit' | 'x'; credentials: { username: string; password: string; clientId: string; clientSecret: string } }
 * Response: { success: true; platform: string; message: string }
 * Sets an httpOnly `agent_session_<platform>` cookie on success.
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { platform, credentials } = req.body as Record<string, unknown>;

    // Validate platform
    if (!isValidPlatform(platform)) {
      res.status(400).json({
        error: 'Invalid platform. Must be one of: reddit, x',
        code: 'INVALID_PLATFORM',
      });
      return;
    }

    // Validate credentials using shared validator
    const validationResult = validateAgentCredentialsInput(credentials);
    if (!validationResult.valid) {
      res.status(400).json({
        error: validationResult.error,
        code: validationResult.code,
      });
      return;
    }

    const userId = req.user!.sub;

    // Validate userId to prevent invalid/malicious IDs
    if (!isValidUserId(userId)) {
      res.status(401).json({
        error: 'Invalid user authentication',
        code: 'INVALID_USER',
      });
      return;
    }

    const pool = getPool();

    if (!pool) {
      res.status(503).json({
        error: 'Database connection not available',
        code: 'DB_UNAVAILABLE',
      });
      return;
    }

    // Best-effort live validation: when the platform's agent service is
    // available, the credentials must actually authenticate before we store
    // them or issue a session. When the service isn't available yet, degrade
    // gracefully (same tolerance as /connect) rather than blocking login on
    // an optional dependency.
    const validator = await validatorRegistry.getValidator(platform);
    if (validator) {
      let isValid: boolean;
      try {
        isValid = await validator.validateCredentials(validationResult.credentials!);
      } catch (validationError) {
        const errorMessage = validationError instanceof Error ? validationError.message : 'Unknown error';
        res.status(401).json({
          error: errorMessage,
          code: 'VALIDATION_FAILED',
        });
        return;
      }

      if (!isValid) {
        res.status(401).json({
          error: `Invalid ${platformLabel(platform)} credentials`,
          code: 'INVALID_CREDENTIALS',
        });
        return;
      }
    }

    await persistEncryptedCredentials(pool, userId, platform, validationResult.credentials!);

    const sessionToken = signAgentSessionToken(userId, platform);
    res.cookie(agentSessionCookieName(platform), sessionToken, agentSessionCookieOptions());

    res.status(200).json({
      success: true,
      platform,
      message: `Successfully logged in to ${platformLabel(platform)}`,
    });
  } catch (error) {
    console.error('[agentAuth] Error logging in:', error);
    res.status(500).json({
      error: 'Failed to log in',
      code: 'LOGIN_ERROR',
    });
  }
});

/**
 * POST /api/agent/validate
 * Test credentials for a platform without storing them.
 * 
 * Body: { platform: 'reddit' | 'x'; credentials: { username: string; password: string; clientId: string; clientSecret: string } }
 * Response: { valid: true; message?: string } or { valid: false; error?: string; code?: string }
 */
router.post('/validate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { platform } = req.body as Record<string, unknown>;

    // Validate platform
    if (!isValidPlatform(platform)) {
      res.status(400).json({
        error: 'Invalid platform. Must be one of: reddit, x',
        code: 'INVALID_PLATFORM',
      });
      return;
    }

    // Validate credentials using shared validator
    const validationResult = validateAgentCredentialsInput(req.body.credentials);
    if (!validationResult.valid) {
      res.status(400).json({
        error: validationResult.error,
        code: validationResult.code,
      });
      return;
    }

    // Get the platform validator
    const validator = await validatorRegistry.getValidator(platform);
    
    if (!validator) {
      res.status(503).json({
        valid: false,
        error: `${platformLabel(platform)} agent service not available`,
        code: 'SERVICE_UNAVAILABLE',
      });
      return;
    }

    try {
      const isValid = await validator.validateCredentials(validationResult.credentials!);
      
      if (isValid) {
        res.status(200).json({
          valid: true,
          message: `${platformLabel(platform)} credentials are valid`,
        });
      } else {
        res.status(401).json({
          valid: false,
          error: `Invalid ${platformLabel(platform)} credentials`,
          code: 'INVALID_CREDENTIALS',
        });
      }
    } catch (validationError) {
      const errorMessage = validationError instanceof Error ? validationError.message : 'Unknown error';
      res.status(401).json({
        valid: false,
        error: errorMessage,
        code: 'VALIDATION_FAILED',
      });
    }
  } catch (error) {
    console.error('[agentAuth] Error validating credentials:', error);
    res.status(500).json({
      error: 'Failed to validate credentials',
      code: 'VALIDATION_ERROR',
    });
  }
});

/**
 * DELETE /api/agent/:platform
 * Remove stored credentials for a platform.
 * 
 * Response: { success: true; message: string }
 */
router.delete('/:platform', async (req: Request, res: Response): Promise<void> => {
  try {
    const { platform } = req.params;

    // Validate platform
    if (!isValidPlatform(platform)) {
      res.status(400).json({
        error: 'Invalid platform. Must be one of: reddit, x',
        code: 'INVALID_PLATFORM',
      });
      return;
    }

    const userId = req.user!.sub;
    
    // Validate userId to prevent invalid/malicious IDs
    if (!isValidUserId(userId)) {
      res.status(401).json({
        error: 'Invalid user authentication',
        code: 'INVALID_USER',
      });
      return;
    }

    const pool = getPool();

    if (!pool) {
      res.status(503).json({
        error: 'Database connection not available',
        code: 'DB_UNAVAILABLE',
      });
      return;
    }

    // Check if credentials exist
    const existing = await findByUserAndPlatform(pool, userId, platform);

    if (!existing) {
      res.status(404).json({
        error: `No credentials found for ${platform}`,
        code: 'NOT_FOUND',
      });
      return;
    }

    // Delete credentials
    await deleteByUserAndPlatform(pool, userId, platform);

    res.status(200).json({
      success: true,
      message: `Successfully removed credentials for ${platform}`,
    });
  } catch (error) {
    console.error('[agentAuth] Error deleting credentials:', error);
    res.status(500).json({
      error: 'Failed to delete credentials',
      code: 'DELETE_ERROR',
    });
  }
});

/**
 * GET /api/agent/status/:platform
 * Check connection status for a platform.
 * 
 * Response: { connected: boolean; platform: string; lastValidated?: string; valid?: boolean }
 */
router.get('/status/:platform', async (req: Request, res: Response): Promise<void> => {
  try {
    const { platform } = req.params;

    // Validate platform
    if (!isValidPlatform(platform)) {
      res.status(400).json({
        error: 'Invalid platform. Must be one of: reddit, x',
        code: 'INVALID_PLATFORM',
      });
      return;
    }

    const userId = req.user!.sub;
    
    // Validate userId to prevent invalid/malicious IDs
    if (!isValidUserId(userId)) {
      res.status(401).json({
        error: 'Invalid user authentication',
        code: 'INVALID_USER',
      });
      return;
    }

    const pool = getPool();

    if (!pool) {
      res.status(503).json({
        error: 'Database connection not available',
        code: 'DB_UNAVAILABLE',
      });
      return;
    }

    // Check if credentials exist
    const credentials = await findByUserAndPlatform(pool, userId, platform);

    if (!credentials) {
      res.status(200).json({
        connected: false,
        platform,
        message: `Not connected to ${platform}`,
      });
      return;
    }

    // Decrypt credentials and validate connection
    try {
      const decrypted = decryptAgentCredentials(credentials.encryptedCredentials);
      
      // Get the platform validator
      const validator = await validatorRegistry.getValidator(platform);
      
      if (!validator) {
        // Agent service not available, but credentials exist
        res.status(200).json({
          connected: true,
          platform,
          lastValidated: credentials.updatedAt,
          valid: false,
          error: `${platformLabel(platform)} agent service not available`,
          code: 'SERVICE_UNAVAILABLE',
        });
        return;
      }
      
      const isValid = await validator.validateCredentials(decrypted);
      
      res.status(200).json({
        connected: true,
        platform,
        lastValidated: credentials.updatedAt,
        valid: isValid,
      });
    } catch (validationError) {
      // Credentials exist but validation failed
      res.status(200).json({
        connected: true,
        platform,
        lastValidated: credentials.updatedAt,
        valid: false,
        error: 'Credentials may be invalid or expired',
        code: 'VALIDATION_FAILED',
      });
    }
  } catch (error) {
    console.error('[agentAuth] Error checking status:', error);
    res.status(500).json({
      error: 'Failed to check connection status',
      code: 'STATUS_ERROR',
    });
  }
});

export default router;