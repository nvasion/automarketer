#!/bin/sh
# Ensure node_modules is always in sync with package-lock.json.
# This is necessary because the named Docker volume persists across image
# rebuilds — a stale volume won't automatically pick up newly-added packages.
set -e

echo "[entrypoint] Running npm ci to sync node_modules..."
npm ci
echo "[entrypoint] Dependencies up to date."

exec "$@"
