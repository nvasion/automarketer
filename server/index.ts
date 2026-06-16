import { app } from './app.js';
import { jwtSecret } from './utils/config.js';
import { userStore } from './models/userStore.js';
import { accessTokenStore } from './models/accessTokenStore.js';
import { campaignStore } from './db/campaignsTable.js';
import { aiPrefsStore } from './db/aiPrefsTable.js';

// ── Security guard ────────────────────────────────────────────────────────────
// Calling jwtSecret() here triggers a hard crash in production when JWT_SECRET
// is missing — before the server binds to any port and accepts traffic.
jwtSecret();

// ── Port validation ───────────────────────────────────────────────────────────
const rawPort = process.env.PORT ?? '3001';
const port = parseInt(rawPort, 10);

// Allow the full valid port range (1–65535) so the server works inside
// containers and managed PaaS environments that commonly bind on ports 80/443.
if (isNaN(port) || port <= 0 || port > 65535) {
  throw new Error(
    `Invalid PORT value: "${rawPort}". Must be an integer between 1 and 65535.`,
  );
}

// ── Initialise user store ────────────────────────────────────────────────────
// Ensures the users table exists and loads existing users into the in-memory
// cache. If DATABASE_URL is not configured this is a no-op.
userStore.initialize().catch((err) => {
  console.error('[server] Failed to initialise user store:', err);
});

// ── Initialise access token store ────────────────────────────────────────────
// Ensures the user_access_tokens table exists for storing OAuth tokens.
accessTokenStore.initialize().catch((err) => {
  console.error('[server] Failed to initialise access token store:', err);
});

// ── Initialise campaign + AI-prefs stores ────────────────────────────────────
// Ensure the campaigns and user_ai_prefs tables exist. No-ops without a database.
campaignStore.initialize().catch((err) => {
  console.error('[server] Failed to initialise campaign store:', err);
});
aiPrefsStore.initialize().catch((err) => {
  console.error('[server] Failed to initialise AI prefs store:', err);
});

// ── Start server ─────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`[server] Express API listening on http://localhost:${port}`);
});
