# AutoMarketer — Setup Guide

End-to-end setup: get the app running, configure the database and auth, and
connect social platforms for publishing. For a fully worked single-platform
example, see [LINKEDIN_SETUP.md](./LINKEDIN_SETUP.md).

---

## 1. Prerequisites

- **Docker 24+** with Compose v2 (`docker compose`, not `docker-compose`) — recommended, runs everything (frontend, API, Postgres).
- _or_ **Node.js 18+** and a **PostgreSQL** instance, to run without Docker.

---

## 2. Configure your environment

All configuration lives in a `.env` file at the repo root. Start from the template:

```bash
cp .env.example .env
```

Then edit the values. The most important ones:

| Variable | Required | Purpose |
|----------|----------|---------|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | dev: defaults OK · prod: **yes** | Database credentials |
| `DATABASE_URL` | recommended | Postgres connection URL. **Without it, data (including platform connections) is in-memory only and lost on every server restart.** |
| `JWT_SECRET` | prod: **yes** | Signs auth cookies. Generate with `openssl rand -hex 64`. |
| `FRONTEND_URL` | prod: **yes** | Origin the app is served from. Also the base of the OAuth callback URL (see §4). |
| `PORT` | no (default 3001) | Express API port |
| `<PLATFORM>_CLIENT_ID` / `<PLATFORM>_CLIENT_SECRET` | per platform you enable | OAuth app credentials (see §4) |

> **Docker note:** the `api` container reads `.env` via `env_file:` in
> `docker-compose.yml`. After changing `.env`, **recreate the container** so it
> picks up the new values — editing `.env` alone does not affect a running
> container:
>
> ```bash
> docker compose up -d --build api
> ```

---

## 3. Run the app

### With Docker (recommended)

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- API: http://localhost:3001 (health check: `GET /api/health`)
- Postgres: localhost:5432

Stop with `docker compose down`.

### Without Docker

```bash
npm install
npm run dev:full     # runs the Vite frontend + the API server together
```

Or run them separately: `npm run dev` (frontend) and `npm run dev:server`
(API). Set `DATABASE_URL` to your Postgres instance, or leave it unset to use
the in-memory store (data is lost on restart).

---

## 4. Connect social platforms

AutoMarketer uses a **single shared OAuth app per platform** (the conventional
SaaS model). You — the operator — register one OAuth app per platform and put
its credentials in the server environment. Every user then connects with one
click; nobody pastes OAuth credentials into the UI.

### 4a. The OAuth callback (redirect) URL — read this first

The callback URL is **always**:

```
<FRONTEND_URL>/oauth/callback
```

- dev: `http://localhost:5173/oauth/callback`
- prod: `https://app.example.com/oauth/callback`

This **exact** value (no trailing slash) must be registered as the Redirect /
Callback URI in each platform's developer dashboard, and `FRONTEND_URL` must
match the origin you actually load the app from in the browser. If they differ,
the provider rejects the token exchange with a `redirect_uri` error.

### 4b. Per-platform credentials

For each platform, create an OAuth app on its developer portal, register the
callback URL from §4a, and set these env vars (both must come from the **same**
app or the token exchange fails with `invalid_client`):

| Platform | Env vars | Developer portal | Scopes / products needed |
|----------|----------|------------------|--------------------------|
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | [LinkedIn Developers](https://www.linkedin.com/developers/apps) | Products: "Share on LinkedIn" + "Sign In with LinkedIn using OpenID Connect" (scopes `openid profile email w_member_social`) |
| Reddit | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | [Reddit apps](https://www.reddit.com/prefs/apps) | App type "web app"; scopes `read submit` |
| Twitter/X | `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` | [X Developer Portal](https://developer.twitter.com/en/portal/dashboard) | OAuth 2.0 + PKCE; scopes `tweet.read tweet.write users.read offline.access` |
| Meta (Facebook / Instagram) | `META_CLIENT_ID`, `META_CLIENT_SECRET` | [Meta for Developers](https://developers.facebook.com/apps) | Products: "Facebook Login" + "Instagram Graph API"; scopes `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish` |

> Meta (Facebook / Instagram) shares a single OAuth app — set only the `META_*` pair; do not
> set separate `FACEBOOK_*` or `INSTAGRAM_*` vars. A platform with no `CLIENT_ID` set shows as
> "not configured on the server" in the connect dialog.

### 4c. Connect from the app

1. Restart/recreate the API server so it picks up the new env vars.
2. Sign in, open **Settings → Connected Platforms**, and click **Connect**.
3. Complete the provider's OAuth popup and approve the requested permissions.

The server exchanges the authorization code for an access token using your
configured Client ID + Secret and stores it for the user (LinkedIn also resolves
and stores the member URN automatically).

### 4d. What actually publishes today

Connecting and publishing are at different stages per platform:

| Platform | Connect (token exchange) | Publish |
|----------|--------------------------|---------|
| **LinkedIn** | ✅ real token + author ID | ✅ working |
| **Reddit** | ⚠️ placeholder token only | ⚠️ connector exists, but needs the real token exchange to post |
| **Twitter/X** | ⚠️ placeholder token only | ❌ not implemented |
| **Facebook** | ⚠️ placeholder token only | ❌ not implemented |
| **Instagram** | ⚠️ placeholder token only | ❌ not implemented |

LinkedIn is the only fully end-to-end path today. The others complete the
connect UI but their server-side token exchange and/or publish connector are
not finished — the server logs a warning when it stores a placeholder token.

---

## 5. Verify it works

1. `GET http://localhost:3001/api/health` returns OK.
2. Register/log in, connect LinkedIn, and publish a post from a campaign.
3. Watch the logs — they narrate every step (see §6).

---

## 6. Troubleshooting

Every step is logged. Check the **server logs** for `[oauth]`, `[publish]`,
`[accessTokenStore]`, and `[platformOAuth]` lines, and the **browser console**
for `[PlatformConnectionModal]`, `[CampaignDetail]`, and `[publishService]`.

| Symptom | Likely cause |
|---------|--------------|
| `[platformOAuth] …_CLIENT_SECRET not set — using dev fallback` | The env var isn't reaching the API process. In Docker, recreate the container (§2). |
| `invalid_client` from the provider | `CLIENT_ID` and `CLIENT_SECRET` are from **different** apps, or the secret is wrong. |
| `redirect_uri` mismatch / `invalid_grant` | The registered callback URL ≠ `<FRONTEND_URL>/oauth/callback` ≠ the browser origin. Check for `http`/`https`, host, port, and trailing-slash differences (§4a). |
| "isn't configured on the server" in the connect dialog | That platform's `CLIENT_ID` env var is empty. |
| Publish returns 401 `MISSING_TOKEN` | No usable access token. The `[accessTokenStore]` log says why: never connected, server restarted with no `DATABASE_URL`, or token expired. Reconnect. |
| Connection "disappears" after a restart | `DATABASE_URL` not set → tokens are in-memory only. Set `DATABASE_URL` for persistence. |

---

## 7. Production notes

- Set all `POSTGRES_*`, `JWT_SECRET`, `FRONTEND_URL`, and per-platform OAuth vars explicitly — no dev fallbacks are allowed when `NODE_ENV=production`.
- Prefer a dedicated secret manager over a plaintext `.env` for client secrets.
- **Known gap:** `docker-compose.prod.yml` currently defines only the nginx
  frontend and Postgres — it does **not** run the API server. A production
  deployment needs the `api` service added (mirroring the dev compose, with
  `target: production` and the env vars above) before publishing will work.
