-- Migration 001: platform_configs table
--
-- Stores OAuth client IDs for each social platform so administrators can
-- configure them through the admin API without touching environment variables
-- or redeploying. Client IDs are PUBLIC values (they appear in every OAuth
-- redirect URL) — never store client secrets in this table.
--
-- Run manually with:
--   psql "$DATABASE_URL" -f server/db/migrations/001_platform_configs.sql
--
-- The application also runs this DDL automatically via ensureTable() on startup,
-- so this file serves primarily as documentation and for CI database setup.

CREATE TABLE IF NOT EXISTS platform_configs (
  platform   TEXT        PRIMARY KEY,
  client_id  TEXT        NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed rows for the five supported platforms so the table always has a
-- complete set of rows. Existing values are left unchanged (DO NOTHING).
INSERT INTO platform_configs (platform, client_id) VALUES
  ('linkedin',  ''),
  ('twitter',   ''),
  ('reddit',    ''),
  ('facebook',  ''),
  ('instagram', '')
ON CONFLICT (platform) DO NOTHING;
