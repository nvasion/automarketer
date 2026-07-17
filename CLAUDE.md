# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AutoMarketer** — AI-powered social media marketing automation. Full-stack TypeScript: React 18 + Vite frontend, Express 5 API, PostgreSQL. Users create campaigns, generate platform-specific posts with AI, and publish/schedule them to LinkedIn, Twitter/X, Reddit, Facebook, Instagram, and Bluesky.

## Commands

```bash
npm run dev:full       # Vite dev server (5173) + Express API (3001) together
npm run dev            # Frontend only
npm run dev:server     # API only (tsx watch server/index.ts)

npm test               # Full test suite (vitest run)
npm run test:watch     # Watch mode
npx vitest run tests/Login.test.tsx        # Single test file
npx vitest run -t "rejects invalid email"  # Single test by name

npm run lint           # ESLint — zero warnings allowed (--max-warnings 0)
npm run build          # tsc + vite build (frontend)
npm run build:server   # Type-check the server only — no emit; server always runs via tsx

docker compose up --build                          # Dev: app + Postgres, hot reload
docker compose -f docker-compose.prod.yml up -d    # Prod: nginx static build + Postgres
```

Requires `.env` (copy from `.env.example`) for Docker; the API reads it via `env_file:`, so after editing `.env` recreate the container — a running container does not pick up changes.

## Architecture

### Two processes, one origin

Vite (port 5173) proxies `/api/*` to Express (port 3001), so the browser always makes same-origin requests and cookies flow without CORS complications. The server is never compiled — `tsx` runs `server/index.ts` directly; `npm run build:server` only type-checks. `server/app.ts` exports a `createApp()` factory separate from the listener specifically so Supertest can test routes without binding a port.

### Authentication

JWT signed with `JWT_SECRET`, delivered exclusively in an `httpOnly` `auth_token` cookie — never in response bodies or localStorage. `server/middleware/auth.ts` (`requireAuth`) guards protected routes; nearly every `/api/*` route requires it. `/api/auth/*` is rate-limited (20 req / 15 min per IP). On the frontend, `AuthContext` + `ProtectedRoute` redirect unauthenticated users to `/login`.

### Database with in-memory fallback

`server/db/connection.ts` creates a lazy pg Pool only when `DATABASE_URL` is set; otherwise every store (`server/db/*Table.ts`, `server/models/*Store.ts`) falls back to an in-memory map. This is why tests and bare `npm run dev:full` work with no database — but data is lost on restart. Tables are auto-provisioned on server start (`CREATE TABLE IF NOT EXISTS`); there are no migration files.

### Service layers (frontend `src/services/`)

Three pluggable layers, each behind an interface, each independently unit-tested:

- **`ai/`** — `InferenceClient` interface with `OpenRouterClient` and `CustomEndpointClient` (any OpenAI-compatible endpoint) implementations; `ContentGenerationService` adds platform-aware prompts, hashtag parsing, and char-limit enforcement. Falls back to built-in template posts when no provider is configured, so the campaign wizard always works.
- **`social/`** — `SocialConnector` interface; `BaseSocialConnector` provides shared `validateContent()`/`enforceLimit()` (word-boundary truncation, hashtag dropping). One connector per platform in `platforms/`, each calling the platform's official API and enforcing its character limit before sending. Reddit posts to multiple subreddits per campaign; partial multi-subreddit failures are non-retryable to prevent double-posting.
- **`queue/`** — pull-based `PostingQueueService`: callers invoke `tick()` (tests/cron) or `start()` for an internal poller. Exponential-backoff retry driven by `SocialError.retryable`; sliding-window per-platform `RateLimiter`; append-only `ExecutionLog` whose error messages pass through `sanitize.ts` (strips HTML, redacts tokens/secrets, truncates).

### OAuth for social platforms (shared-app model)

One OAuth app per platform, owned by the operator: `<PLATFORM>_CLIENT_ID` / `<PLATFORM>_CLIENT_SECRET` env vars (Facebook + Instagram share the `META_*` pair). Client IDs are served to the browser via `GET /api/platform-config`; secrets stay server-side and are used in `server/routes/oauthCallback.ts` to exchange the authorization code. The redirect URI is always `<FRONTEND_URL>/oauth/callback` and must be registered exactly in each platform's developer portal — ID and secret must come from the same app or the exchange fails with `invalid_client`. Bluesky is the exception: it uses AT Protocol OAuth with DPoP-bound tokens (`server/utils/blueskyOAuth.ts`, `dpopKeyEncryption.ts`) and its own routes in `server/routes/bluesky.ts`. Access tokens are stored per-user in the `user_access_tokens` table; `server/utils/tokenRefresh.ts` handles refresh.

### AI API keys never touch the server

By deliberate design, AI provider keys are entered in Settings → AI Settings and stored in browser localStorage only. Do not move them to `VITE_*` env vars (they'd be baked into the JS bundle) or send them to the API. Only non-sensitive generation preferences (tone, emoji, temperature, …) sync server-side via `/api/ai-prefs`.

### Testing setup

Single vitest config with per-path environments (`vitest.config.ts` `environmentMatchGlobs`): server, queue, and e2e tests run in `node`; everything else in `jsdom`. Test timeout is 30 s because bcrypt cost-12 hashing is slow on CI. Server route tests use Supertest against `createApp()`; connector and e2e tests mock global `fetch` rather than hitting real APIs.

### Vite config quirks

`base` is `'./'` in dev (so the dev server works behind a reverse proxy at a subpath) but `'/'` in production builds (deep routes like `/oauth/callback` would otherwise 404 on assets). HMR defaults to wss:443 for cloud proxies; `docker-compose.yml` overrides via `HMR_CLIENT_PORT`/`HMR_PROTOCOL` for localhost. Don't "simplify" these — the comments in `vite.config.ts` explain each.

## Conventions

- TypeScript strict mode; functional React components with hooks.
- ESLint runs with `--max-warnings 0` — any warning fails the lint.
- Server imports use `.js` extensions (`import authRouter from './routes/auth.js'`) — Node ESM resolution; keep this in new server files.
- README.md is extensive and treated as living documentation — update the relevant section when you change commands, endpoints, env vars, or architecture. SETUP.md covers operator setup (OAuth app registration, callbacks); LINKEDIN_SETUP.md covers LinkedIn specifics.
- Production fails fast on missing config (`FRONTEND_URL`, `JWT_SECRET` guards) — follow this pattern for new required env vars rather than silently defaulting.
