// ── Agent token usage tracker ─────────────────────────────────────────────────
// Tracks API token consumption for agent operations (Reddit/X agent services)
// so usage can be surfaced on a per-user metrics endpoint and, eventually, used
// to enforce quotas.
//
// Storage strategy: in-memory only, mirroring the existing accessTokenStore
// cache pattern (server/models/accessTokenStore.ts). This module intentionally
// has no database dependency — usage counters reset on server restart, which
// is acceptable for a monitoring/observability feature. If durability across
// restarts becomes a requirement, a table can be layered on top of the same
// `recordTokenUsage` entry point without changing callers.

import type { NextFunction, Request, Response } from 'express';

/** Platforms that agent operations can consume tokens against. */
export type AgentPlatform = 'reddit' | 'x';

/** Type guard for AgentPlatform. */
export function isAgentPlatform(value: unknown): value is AgentPlatform {
  return value === 'reddit' || value === 'x';
}

/** A single recorded token-usage event for one agent API operation. */
export interface TokenUsageRecord {
  userId: string;
  platform: AgentPlatform;
  operation: string;
  tokens: number;
  timestamp: string; // ISO 8601
}

/** Aggregated usage totals for a user, broken down by platform. */
export interface UsageSummary {
  userId: string;
  totalTokens: number;
  totalRequests: number;
  byPlatform: Record<AgentPlatform, { tokens: number; requests: number }>;
}

/** Shape a route handler sets on `res.locals.tokenUsage` to report consumption. */
export interface ReportedTokenUsage {
  platform: AgentPlatform;
  operation?: string;
  tokens: number;
}

// Caps how many records are retained per user so a single account can't grow
// the process's memory unboundedly. Oldest records are evicted first.
const MAX_RECORDS_PER_USER = 1000;

// Per-user in-memory ledger: Map<userId, TokenUsageRecord[]>
const usageLedger = new Map<string, TokenUsageRecord[]>();

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/**
 * Records a single token-usage event for a user's agent operation.
 *
 * Throws on malformed input rather than silently dropping it — callers
 * (the middleware below, or direct callers from agent services) are expected
 * to handle/log the error themselves so bad data never corrupts aggregate
 * metrics silently.
 */
export function recordTokenUsage(
  userId: string,
  platform: AgentPlatform,
  operation: string,
  tokens: number,
): TokenUsageRecord {
  if (!isNonEmptyString(userId)) {
    throw new Error('recordTokenUsage: userId must be a non-empty string');
  }
  if (!isAgentPlatform(platform)) {
    throw new Error(`recordTokenUsage: invalid platform "${String(platform)}"`);
  }
  if (!isNonEmptyString(operation)) {
    throw new Error('recordTokenUsage: operation must be a non-empty string');
  }
  if (!isNonNegativeInteger(tokens)) {
    throw new Error('recordTokenUsage: tokens must be a non-negative integer');
  }

  const record: TokenUsageRecord = {
    userId,
    platform,
    // Bound the operation label so an unexpectedly huge string can't bloat memory.
    operation: operation.trim().slice(0, 128),
    tokens,
    timestamp: new Date().toISOString(),
  };

  const records = usageLedger.get(userId) ?? [];
  records.push(record);
  if (records.length > MAX_RECORDS_PER_USER) {
    records.shift(); // evict oldest — bounds memory per user
  }
  usageLedger.set(userId, records);

  return record;
}

/**
 * Returns aggregated usage totals for a user across all tracked platforms.
 * Users with no recorded usage get an all-zero summary (never throws/404s —
 * "no usage yet" is a valid, common state).
 */
export function getUsageSummary(userId: string): UsageSummary {
  const records = usageLedger.get(userId) ?? [];

  const byPlatform: Record<AgentPlatform, { tokens: number; requests: number }> = {
    reddit: { tokens: 0, requests: 0 },
    x: { tokens: 0, requests: 0 },
  };

  let totalTokens = 0;
  for (const record of records) {
    byPlatform[record.platform].tokens += record.tokens;
    byPlatform[record.platform].requests += 1;
    totalTokens += record.tokens;
  }

  return {
    userId,
    totalTokens,
    totalRequests: records.length,
    byPlatform,
  };
}

/**
 * Returns the most recent usage records for a user, newest first.
 * `limit` is clamped to [1, MAX_RECORDS_PER_USER] to prevent callers from
 * requesting unbounded result sets.
 */
export function getRecentUsage(userId: string, limit = 50): TokenUsageRecord[] {
  const records = usageLedger.get(userId) ?? [];
  const safeLimit = Number.isFinite(limit) ? Math.trunc(limit) : 50;
  const boundedLimit = Math.min(Math.max(safeLimit, 1), MAX_RECORDS_PER_USER);
  return records.slice(-boundedLimit).reverse();
}

/** Clears all tracked usage for a single user. Exposed for tests. */
export function clearUsage(userId: string): void {
  usageLedger.delete(userId);
}

/** Clears the entire in-memory ledger. Exposed for tests. */
export function clearAllUsage(): void {
  usageLedger.clear();
}

/**
 * Express middleware that records token usage for agent API operations.
 *
 * Downstream route handlers report consumption by setting
 * `res.locals.tokenUsage = { platform, operation?, tokens }` before the
 * response is sent. This middleware listens for the `finish` event and
 * records the usage once the response has actually gone out — it never
 * delays or blocks the response, and a missing/malformed report is logged
 * and skipped rather than thrown into the request pipeline.
 *
 * Intended to be mounted on routes that call out to Reddit/X agent services,
 * e.g. `router.use(trackAgentTokenUsage())` in an agent-facing router.
 */
export function trackAgentTokenUsage() {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.on('finish', () => {
      const usage = res.locals.tokenUsage as Partial<ReportedTokenUsage> | undefined;
      if (!usage) return; // handler didn't report usage for this request — nothing to do

      const userId = req.user?.sub;
      if (!isNonEmptyString(userId)) {
        console.warn('[tokenUsageTracker] skipped usage record: no authenticated user on request');
        return;
      }

      if (!isAgentPlatform(usage.platform)) {
        console.warn(`[tokenUsageTracker] skipped usage record: invalid platform "${String(usage.platform)}"`);
        return;
      }

      const operation = isNonEmptyString(usage.operation) ? usage.operation : req.path;

      try {
        recordTokenUsage(userId, usage.platform, operation, usage.tokens as number);
      } catch (err) {
        console.error(
          '[tokenUsageTracker] failed to record usage:',
          err instanceof Error ? err.message : String(err),
        );
      }
    });

    next();
  };
}
