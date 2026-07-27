-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE NOT NULL,
  password     TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- projects created WITHOUT last_active_branch_id for now — added after branches exists
CREATE TABLE projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE commits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id    UUID REFERENCES commits(id),
  message      TEXT,
  snapshot_key TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE branches (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  head_commit_id       UUID REFERENCES commits(id),
  current_snapshot_key TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, name)
);

-- Now that branches exists, add the circular reference from projects
ALTER TABLE projects
  ADD COLUMN last_active_branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE TABLE brush_presets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  settings     JSONB NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_settings (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings     JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX ON projects(user_id);
CREATE INDEX ON commits(project_id);
CREATE INDEX ON commits(parent_id);
CREATE INDEX ON branches(project_id);
CREATE INDEX ON brush_presets(user_id);