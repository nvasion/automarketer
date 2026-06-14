# LinkedIn Publishing Setup

> For general setup (running the app, all platforms, the shared-app OAuth model,
> and troubleshooting) see [**SETUP.md**](./SETUP.md). This document is the
> detailed, worked LinkedIn example.

## Overview

This document explains how to set up LinkedIn publishing in AutoMarketer.

## Prerequisites

1. A LinkedIn Developer account
2. A LinkedIn app with the required permissions

## Step 1: Create a LinkedIn App

1. Go to the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps)
2. Click "Create app"
3. Fill in the required information:
   - App name
   - LinkedIn Page (optional but recommended)
   - App logo
4. Accept the terms and click "Create"

## Step 2: Configure OAuth

1. Go to the "Auth" tab in your app dashboard
2. Add the **Authorized redirect URL**. This must be exactly `<FRONTEND_URL>/oauth/callback` (no trailing slash):
   - development: `http://localhost:5173/oauth/callback`
   - production: `https://yourdomain.com/oauth/callback`

   It must match the `FRONTEND_URL` you set on the server (Step 4) and the origin you load the app from in the browser — a mismatch causes the token exchange to fail with a `redirect_uri` error.
3. Note your **Client ID** and **Client Secret** — both go in the server `.env` (Step 4)

## Step 3: Request Products

1. Go to the "Products" tab
2. Request access to:
   - **Share on LinkedIn** - for posting content
   - **Sign In with LinkedIn using OpenID Connect** - for authentication
3. ⚠️ **Important**: After adding products, you may need to complete app verification or wait for LinkedIn approval before OAuth will work. If you get an "invalid_scope_error", check that both products are approved in your app dashboard.

## Step 4: Set the Client ID and Secret on the Server

AutoMarketer uses **one shared LinkedIn OAuth app** for all users, configured
via environment variables — nobody pastes credentials into the UI. Put **both**
your app's Client ID and Client Secret (from the "Auth" tab) in the server
environment:

```bash
# .env
LINKEDIN_CLIENT_ID=your_client_id_here
LINKEDIN_CLIENT_SECRET=your_client_secret_here
```

> **Docker:** the `api` service loads `.env` via `env_file:` in
> `docker-compose.yml`. After editing `.env`, recreate the container so it picks
> up the new values: `docker compose up -d --build api`. (Setting a var in
> `.env` is **not** enough on its own — the container must be recreated.)

The Client ID and Secret **must belong to the same LinkedIn app**, or the token
exchange fails with `invalid_client`. Without the secret, it fails with
`TOKEN_EXCHANGE_FAILED`. Either way the `[oauth]` server logs show the exact
reason.

## Step 5: Connect in AutoMarketer

1. Go to Settings → Connected Platforms
2. Click "Connect" on LinkedIn
3. Click "Sign in with LinkedIn" and authorize the app when prompted

(If LinkedIn shows "isn't configured on the server", the `LINKEDIN_CLIENT_ID` /
`LINKEDIN_CLIENT_SECRET` env vars aren't reaching the API server — see the
Docker note in Step 4.)

When the flow completes, the server exchanges the code for a real access
token, resolves your LinkedIn member URN (author ID) via the OpenID Connect
`userinfo` endpoint, and the app stores it automatically — no manual steps.

> **Note:** Without `DATABASE_URL` set, tokens are kept in server memory only
> and are lost whenever the API server restarts (including `tsx watch`
> restarts during development). Reconnect after a restart, or configure
> `DATABASE_URL` for persistence.

## Troubleshooting

Every step of the connect/publish flow is logged. Check the **server logs**
for `[oauth]`, `[publish]`, and `[accessTokenStore]` lines, and the **browser
console** for `[PlatformConnectionModal]`, `[CampaignDetail]`, and
`[publishService]` lines — they state the exact reason for a failure.

### "LinkedIn is not connected"
- Go to Settings → Connected Platforms and make sure LinkedIn shows "Connected"
- If not, click "Connect" and complete the OAuth flow

### "No access token found for linkedin" (publish returns 401)
- The server's token store has no usable token. The `[accessTokenStore]` log
  line states why: never connected, server restarted without `DATABASE_URL`,
  or the token expired. Reconnect LinkedIn in Settings.

### "LinkedIn author ID not found"
- The author ID is stored in the browser automatically when the OAuth flow
  completes. Disconnect and reconnect LinkedIn in Settings to refresh it.
- If reconnecting doesn't help, check the server `[oauth]` logs — a failed
  `userinfo` request usually means the "Sign In with LinkedIn using OpenID
  Connect" product isn't approved yet.

### "TOKEN_EXCHANGE_FAILED"
- `LINKEDIN_CLIENT_SECRET` is missing or wrong, or the redirect URI sent by
  the server (`FRONTEND_URL` + `/oauth/callback`) doesn't exactly match the
  one registered in the LinkedIn app. The `[oauth]` server log includes
  LinkedIn's error response body.

### "invalid_scope_error"
- Check that both "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect" products are approved in your LinkedIn app dashboard
- Wait for LinkedIn approval if pending (can take 1-3 business days)

### "Authorization failed"
- Check that your redirect URL exactly matches what's configured in LinkedIn (including http/https and trailing slashes)
- Make sure popups are not blocked by your browser

## API Reference

### Publish Endpoint

```
POST /api/publish/linkedin
Content-Type: application/json
Cookie: auth_token=...

{
  "content": "Your post content here",
  "hashtags": ["#SaaS", "#Launch"],
  "linkedIn": {
    "authorId": "urn:li:person:abc123xyz"
  }
}
```

Response:
```json
{
  "success": true,
  "platform": "linkedin",
  "postId": "urn:li:share:123456789",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Security Notes

- Access tokens are stored server-side and associated with your user account
- Never share your Client ID or access tokens publicly
- In production, ensure HTTPS is enabled to protect credentials in transit
