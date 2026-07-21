-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE NOT NULL,
  password     TEXT NOT NULL,          -- bcrypt hash
  display_name TEXT NOT NULL,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- PROJECTS  (a painting = a project)
-- ─────────────────────────────────────────
CREATE TABLE projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  last_active_branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- COMMITS  (immutable snapshots)
-- ─────────────────────────────────────────
CREATE TABLE commits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id    UUID REFERENCES commits(id),   -- NULL for the first commit
  message      TEXT,
  snapshot_key TEXT NOT NULL,                 -- MinIO object key for the binary data
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- BRANCHES  (named pointers to commits)
-- ─────────────────────────────────────────
CREATE TABLE branches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  head_commit_id UUID REFERENCES commits(id),  -- the latest commit on this branch
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, name)                     -- no duplicate branch names per project
);

-- ─────────────────────────────────────────
-- BRUSH PRESETS  (per user)
-- ─────────────────────────────────────────
CREATE TABLE brush_presets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  settings     JSONB NOT NULL,               -- flexible: size, opacity, texture, etc.
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- USER SETTINGS (stores app-wide preferences per user)
-- ─────────────────────────────────────────
CREATE TABLE user_settings (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings     JSONB NOT NULL DEFAULT '{}'   -- theme, shortcuts, canvas defaults, etc.
);

-- ─────────────────────────────────────────
-- INDEXES  (for query performance)
-- ─────────────────────────────────────────
CREATE INDEX ON projects(user_id);
CREATE INDEX ON commits(project_id);
CREATE INDEX ON commits(parent_id);
CREATE INDEX ON branches(project_id);
CREATE INDEX ON brush_presets(user_id);