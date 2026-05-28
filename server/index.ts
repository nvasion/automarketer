import { app } from './app.js';
import { jwtSecret } from './utils/config.js';

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

// ── Start server ─────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`[server] Express API listening on http://localhost:${port}`);
});
