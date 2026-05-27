-- Requiem schema. Idempotent — safe to run repeatedly.
-- Mirrors the shared types in src/lib/types.ts.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS scripts (
  id          TEXT PRIMARY KEY,
  repo_url    TEXT NOT NULL,
  path        TEXT NOT NULL,
  filename    TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scripts_repo_url_idx ON scripts (repo_url);

CREATE TABLE IF NOT EXISTS migrations (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  script_id   TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  steps       JSONB NOT NULL,
  summary     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('migrated', 'failed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS migrations_script_id_idx ON migrations (script_id);

CREATE TABLE IF NOT EXISTS dangers (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  script_id   TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  pattern     TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  description TEXT NOT NULL,
  fix         TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dangers_script_id_idx ON dangers (script_id);

CREATE TABLE IF NOT EXISTS incidents (
  id            TEXT PRIMARY KEY,
  alert_source  TEXT NOT NULL,
  alert_summary TEXT NOT NULL,
  workflow_id   TEXT NOT NULL,
  diagnosis     TEXT NOT NULL,
  proposed_fix  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN (
                  'diagnosing', 'awaiting_approval', 'approved',
                  'running', 'complete', 'failed'
                )),
  approved_by   TEXT,
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents (status);

CREATE TABLE IF NOT EXISTS executions (
  id            TEXT PRIMARY KEY,
  workflow_id   TEXT NOT NULL,
  step_results  JSONB NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        TEXT NOT NULL CHECK (source IN ('superplane', 'local_log'))
);

CREATE INDEX IF NOT EXISTS executions_workflow_id_idx ON executions (workflow_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_log_timestamp_idx ON audit_log (timestamp DESC);
