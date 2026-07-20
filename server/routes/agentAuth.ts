import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
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
const VALID_PLATFORMS: PlatformType[] = ['reddit', 'x'];

// ── Input validators ─────────────────────────────────────────────────────────

/**
 * Validates that a string is a valid platform type.
 */
function isValidPlatform(value: string): value is PlatformType {
  return isPlatformType(value);
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
      let validator: PlatformValidator;

      if (platform === 'reddit') {
        const agentModule = await import('../services/social/redditAgent.js');
        
        // Type guard to ensure the module has the expected function
        if (!('validateCredentials' in agentModule) || typeof agentModule.validateCredentials !== 'function') {
          return null;
        }
        
        validator = {
          validateCredentials: agentModule.validateCredentials.bind(agentModule),
        };
      } else if (platform === 'x') {
        const agentModule = await import('../services/social/xAgent.js');
        
        // Type guard to ensure the module has the expected function
        if (!('validateCredentials' in agentModule) || typeof agentModule.validateCredentials !== 'function') {
          return null;
        }
        
        validator = {
          validateCredentials: agentModule.validateCredentials.bind(agentModule),
        };
      } else {
        return null;
      }

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
    if (!isValidPlatform(platform as string)) {
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

    // Ensure table exists
    await ensureTable(pool);

    // Encrypt credentials before storing
    const encryptedCredentials = encryptAgentCredentials(validationResult.credentials!);

    // Check if credentials already exist for this user/platform
    const existing = await findByUserAndPlatform(pool, userId, platform);

    if (existing) {
      // Update existing credentials
      await updateCredentials(pool, userId, platform, encryptedCredentials);
    } else {
      // Insert new credentials
      await insertCredentials(pool, userId, platform, encryptedCredentials);
    }

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
    if (!isValidPlatform(platform as string)) {
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
        error: `${platform === 'reddit' ? 'Reddit' : 'X (Twitter)'} agent service not available`,
        code: 'SERVICE_UNAVAILABLE',
      });
      return;
    }

    try {
      const isValid = await validator.validateCredentials(validationResult.credentials!);
      
      if (isValid) {
        res.status(200).json({
          valid: true,
          message: `${platform === 'reddit' ? 'Reddit' : 'X (Twitter)'} credentials are valid`,
        });
      } else {
        res.status(401).json({
          valid: false,
          error: `Invalid ${platform === 'reddit' ? 'Reddit' : 'X (Twitter)'} credentials`,
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
          error: `${platform === 'reddit' ? 'Reddit' : 'X (Twitter)'} agent service not available`,
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