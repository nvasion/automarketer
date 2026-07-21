// @vitest-environment node
/**
 * Tests for the agent token usage tracker (server/utils/tokenUsageTracker.ts)
 * and the /api/agent-metrics routes (server/routes/agentMetrics.ts).
 *
 * The metrics router isn't wired into the shared server/app.ts (route wiring
 * is owned by a different task), so these tests mount it on a minimal
 * standalone Express app — mirroring how server/app.ts assembles cookie
 * parsing + JSON body parsing + the router under test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import {
  recordTokenUsage,
  getUsageSummary,
  getRecentUsage,
  clearAllUsage,
  trackAgentTokenUsage,
  isAgentPlatform,
} from '../../server/utils/tokenUsageTracker';
import { jwtSecret } from '../../server/utils/config';
import agentMetricsRouter from '../../server/routes/agentMetrics';

function buildApp(): express.Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/agent-metrics', agentMetricsRouter);
  return app;
}

function signCookie(userId: string): string {
  const token = jwt.sign({ sub: userId, email: `${userId}@example.com` }, jwtSecret(), {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  return `auth_token=${token}`;
}

beforeEach(() => {
  clearAllUsage();
});

afterEach(() => {
  clearAllUsage();
});

// ── tokenUsageTracker unit tests ───────────────────────────────────────────────

describe('isAgentPlatform', () => {
  it('accepts reddit and x', () => {
    expect(isAgentPlatform('reddit')).toBe(true);
    expect(isAgentPlatform('x')).toBe(true);
  });

  it('rejects unknown platforms and non-strings', () => {
    expect(isAgentPlatform('twitter')).toBe(false);
    expect(isAgentPlatform('')).toBe(false);
    expect(isAgentPlatform(undefined)).toBe(false);
    expect(isAgentPlatform(42)).toBe(false);
  });
});

describe('recordTokenUsage', () => {
  it('records a usage event and returns it with a timestamp', () => {
    const record = recordTokenUsage('user-1', 'reddit', 'submitPost', 120);
    expect(record.userId).toBe('user-1');
    expect(record.platform).toBe('reddit');
    expect(record.operation).toBe('submitPost');
    expect(record.tokens).toBe(120);
    expect(() => new Date(record.timestamp).toISOString()).not.toThrow();
  });

  it('rejects an empty userId', () => {
    expect(() => recordTokenUsage('', 'reddit', 'post', 10)).toThrow(/userId/);
  });

  it('rejects an invalid platform', () => {
    // @ts-expect-error intentionally passing an invalid platform to test the runtime guard
    expect(() => recordTokenUsage('user-1', 'twitter', 'post', 10)).toThrow(/platform/);
  });

  it('rejects an empty operation', () => {
    expect(() => recordTokenUsage('user-1', 'reddit', '', 10)).toThrow(/operation/);
  });

  it('rejects negative token counts', () => {
    expect(() => recordTokenUsage('user-1', 'reddit', 'post', -5)).toThrow(/tokens/);
  });

  it('rejects non-integer token counts', () => {
    expect(() => recordTokenUsage('user-1', 'reddit', 'post', 1.5)).toThrow(/tokens/);
  });

  it('truncates an excessively long operation label', () => {
    const longOp = 'a'.repeat(500);
    const record = recordTokenUsage('user-1', 'reddit', longOp, 1);
    expect(record.operation.length).toBe(128);
  });

  it('evicts the oldest record once a user exceeds the retention cap', () => {
    for (let i = 0; i < 1001; i++) {
      recordTokenUsage('user-cap', 'reddit', `op-${i}`, 1);
    }
    const recent = getRecentUsage('user-cap', 1000);
    expect(recent.length).toBe(1000);
    // The very first record (op-0) should have been evicted.
    expect(recent.some((r) => r.operation === 'op-0')).toBe(false);
    expect(recent.some((r) => r.operation === 'op-1000')).toBe(true);
  });
});

describe('getUsageSummary', () => {
  it('returns an all-zero summary for a user with no usage', () => {
    const summary = getUsageSummary('unknown-user');
    expect(summary).toEqual({
      userId: 'unknown-user',
      totalTokens: 0,
      totalRequests: 0,
      byPlatform: {
        reddit: { tokens: 0, requests: 0 },
        x: { tokens: 0, requests: 0 },
      },
    });
  });

  it('aggregates totals and per-platform breakdowns across multiple records', () => {
    recordTokenUsage('user-2', 'reddit', 'submitPost', 100);
    recordTokenUsage('user-2', 'reddit', 'comment', 50);
    recordTokenUsage('user-2', 'x', 'tweet', 30);

    const summary = getUsageSummary('user-2');
    expect(summary.totalTokens).toBe(180);
    expect(summary.totalRequests).toBe(3);
    expect(summary.byPlatform.reddit).toEqual({ tokens: 150, requests: 2 });
    expect(summary.byPlatform.x).toEqual({ tokens: 30, requests: 1 });
  });

  it('keeps usage isolated between users', () => {
    recordTokenUsage('user-a', 'reddit', 'post', 10);
    recordTokenUsage('user-b', 'reddit', 'post', 99);

    expect(getUsageSummary('user-a').totalTokens).toBe(10);
    expect(getUsageSummary('user-b').totalTokens).toBe(99);
  });
});

describe('getRecentUsage', () => {
  it('returns records newest-first', () => {
    recordTokenUsage('user-3', 'reddit', 'first', 1);
    recordTokenUsage('user-3', 'reddit', 'second', 2);
    recordTokenUsage('user-3', 'reddit', 'third', 3);

    const recent = getRecentUsage('user-3');
    expect(recent.map((r) => r.operation)).toEqual(['third', 'second', 'first']);
  });

  it('clamps a limit below 1 up to 1', () => {
    recordTokenUsage('user-4', 'reddit', 'only', 1);
    expect(getRecentUsage('user-4', 0).length).toBe(1);
    expect(getRecentUsage('user-4', -5).length).toBe(1);
  });

  it('returns an empty array for a user with no usage', () => {
    expect(getRecentUsage('nobody')).toEqual([]);
  });
});

describe('trackAgentTokenUsage middleware', () => {
  function buildTrackerTestApp(): express.Application {
    const app = express();
    app.use(cookieParser());
    app.use((req, res, next) => {
      // Minimal stand-in for requireAuth so the middleware sees req.user.
      const token = req.cookies?.auth_token as string | undefined;
      if (token) {
        try {
          req.user = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] }) as { sub: string; email: string };
        } catch {
          // ignore — leaves req.user undefined, exercised by the "unauthenticated" test
        }
      }
      next();
    });
    app.use(trackAgentTokenUsage());
    app.get('/agent-op', (req, res) => {
      res.locals.tokenUsage = { platform: 'reddit', operation: 'submitPost', tokens: 42 };
      res.status(200).json({ ok: true });
    });
    app.get('/agent-op-no-report', (req, res) => {
      res.status(200).json({ ok: true });
    });
    app.get('/agent-op-bad-platform', (req, res) => {
      res.locals.tokenUsage = { platform: 'twitter', operation: 'x', tokens: 1 };
      res.status(200).json({ ok: true });
    });
    return app;
  }

  it('records usage reported via res.locals.tokenUsage after the response finishes', async () => {
    const app = buildTrackerTestApp();
    const res = await request(app).get('/agent-op').set('Cookie', signCookie('mw-user-1'));
    expect(res.status).toBe(200);

    // res.on('finish') fires asynchronously after supertest receives the response.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const summary = getUsageSummary('mw-user-1');
    expect(summary.totalTokens).toBe(42);
    expect(summary.byPlatform.reddit).toEqual({ tokens: 42, requests: 1 });
  });

  it('does nothing when the handler reports no usage', async () => {
    const app = buildTrackerTestApp();
    await request(app).get('/agent-op-no-report').set('Cookie', signCookie('mw-user-2'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(getUsageSummary('mw-user-2').totalRequests).toBe(0);
  });

  it('skips recording when there is no authenticated user', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = buildTrackerTestApp();
    await request(app).get('/agent-op'); // no cookie
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no authenticated user'),
    );
    warnSpy.mockRestore();
  });

  it('skips recording when the reported platform is invalid', async () => {
    const app = buildTrackerTestApp();
    await request(app).get('/agent-op-bad-platform').set('Cookie', signCookie('mw-user-3'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(getUsageSummary('mw-user-3').totalRequests).toBe(0);
  });
});

// ── /api/agent-metrics route tests ─────────────────────────────────────────────

describe('GET /api/agent-metrics', () => {
  it('rejects unauthenticated requests', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/agent-metrics');
    expect(res.status).toBe(401);
  });

  it('returns an all-zero summary for a user with no usage', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/agent-metrics').set('Cookie', signCookie('route-user-1'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      userId: 'route-user-1',
      totalTokens: 0,
      totalRequests: 0,
      byPlatform: {
        reddit: { tokens: 0, requests: 0 },
        x: { tokens: 0, requests: 0 },
      },
    });
  });

  it('returns aggregated usage for the authenticated user', async () => {
    recordTokenUsage('route-user-2', 'reddit', 'submitPost', 100);
    recordTokenUsage('route-user-2', 'x', 'tweet', 25);

    const app = buildApp();
    const res = await request(app).get('/api/agent-metrics').set('Cookie', signCookie('route-user-2'));
    expect(res.status).toBe(200);
    expect(res.body.totalTokens).toBe(125);
    expect(res.body.byPlatform.reddit.tokens).toBe(100);
    expect(res.body.byPlatform.x.tokens).toBe(25);
  });

  it('does not leak another user’s usage', async () => {
    recordTokenUsage('route-user-other', 'reddit', 'submitPost', 999);

    const app = buildApp();
    const res = await request(app).get('/api/agent-metrics').set('Cookie', signCookie('route-user-3'));
    expect(res.status).toBe(200);
    expect(res.body.totalTokens).toBe(0);
  });
});

describe('GET /api/agent-metrics/recent', () => {
  it('rejects unauthenticated requests', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/agent-metrics/recent');
    expect(res.status).toBe(401);
  });

  it('returns recent records newest-first, defaulting the limit', async () => {
    recordTokenUsage('route-user-4', 'reddit', 'first', 1);
    recordTokenUsage('route-user-4', 'reddit', 'second', 2);

    const app = buildApp();
    const res = await request(app).get('/api/agent-metrics/recent').set('Cookie', signCookie('route-user-4'));
    expect(res.status).toBe(200);
    expect(res.body.records.map((r: { operation: string }) => r.operation)).toEqual(['second', 'first']);
  });

  it('respects a valid limit query param', async () => {
    recordTokenUsage('route-user-5', 'reddit', 'a', 1);
    recordTokenUsage('route-user-5', 'reddit', 'b', 1);
    recordTokenUsage('route-user-5', 'reddit', 'c', 1);

    const app = buildApp();
    const res = await request(app)
      .get('/api/agent-metrics/recent?limit=2')
      .set('Cookie', signCookie('route-user-5'));
    expect(res.status).toBe(200);
    expect(res.body.records.length).toBe(2);
  });

  it('falls back to the default limit for a non-numeric limit', async () => {
    recordTokenUsage('route-user-6', 'reddit', 'a', 1);

    const app = buildApp();
    const res = await request(app)
      .get('/api/agent-metrics/recent?limit=not-a-number')
      .set('Cookie', signCookie('route-user-6'));
    expect(res.status).toBe(200);
    expect(res.body.records.length).toBe(1);
  });
});

describe('GET /api/agent-metrics/:platform', () => {
  it('rejects unauthenticated requests', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/agent-metrics/reddit');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid platform', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/agent-metrics/twitter')
      .set('Cookie', signCookie('route-user-7'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PLATFORM');
  });

  it('returns per-platform usage for a valid platform', async () => {
    recordTokenUsage('route-user-8', 'reddit', 'submitPost', 40);
    recordTokenUsage('route-user-8', 'x', 'tweet', 10);

    const app = buildApp();
    const res = await request(app)
      .get('/api/agent-metrics/reddit')
      .set('Cookie', signCookie('route-user-8'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'route-user-8', platform: 'reddit', tokens: 40, requests: 1 });
  });
});
