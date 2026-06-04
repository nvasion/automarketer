-- Migration 001: user_platform_configs table
--
-- Stores OAuth client IDs per user, per social platform. Every account owns
-- its own OAuth apps and pastes the resulting client IDs into the connection
-- modal — there is no shared global config and no administrator role.
--
-- Client IDs are PUBLIC values (they appear in every OAuth redirect URL) —
-- never store client secrets in this table.
--
-- Run manually with:
--   psql "$DATABASE_URL" -f server/db/migrations/001_platform_configs.sql
--
-- The application also runs this DDL automatically via ensureTable() on
-- startup, so this file serves primarily as documentation and CI setup.

CREATE TABLE IF NOT EXISTS user_platform_configs (
  user_id    TEXT        NOT NULL,
  platform   TEXT        NOT NULL,
  client_id  TEXT        NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, platform)
);
