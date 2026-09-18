-- 简历工坊 · 建表 SQL（自托管时在 Supabase / PostgreSQL 中执行）
-- 幂等：可重复执行。表不限定 schema（在线版运行在独立 tenant schema 中）。

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  username      text NOT NULL UNIQUE,
  pass_salt     text NOT NULL,
  pass_hash     text NOT NULL,
  restore_hash  text,
  restore_salt  text,
  role          text NOT NULL DEFAULT 'user',
  failed_count  int  NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token       text PRIMARY KEY,
  owner       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_owner_idx ON sessions (owner);

CREATE TABLE IF NOT EXISTS invite_codes (
  code       text PRIMARY KEY,
  label      text,
  max_uses   int  NOT NULL DEFAULT 50,
  used       int  NOT NULL DEFAULT 0,
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resumes (
  id         text PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  owner      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT '未命名简历',
  layout     text NOT NULL DEFAULT 'default',
  theme      jsonb NOT NULL DEFAULT '{}'::jsonb,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  score      int  NOT NULL DEFAULT 0,
  label      text NOT NULL DEFAULT '',
  version    int  NOT NULL DEFAULT 1,
  archived   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resumes_owner_idx ON resumes (owner, updated_at DESC);
CREATE INDEX IF NOT EXISTS resumes_owner_label_idx ON resumes (owner, label);

CREATE TABLE IF NOT EXISTS resume_versions (
  id         text PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  resume_id  text NOT NULL,
  owner      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version    int  NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  layout     text,
  theme      jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resume_versions_rid_idx ON resume_versions (resume_id, version DESC);
CREATE INDEX IF NOT EXISTS resume_versions_owner_idx ON resume_versions (owner, resume_id);

CREATE TABLE IF NOT EXISTS applications (
  id         text PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  owner      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id  text,
  company    text NOT NULL DEFAULT '',
  position   text,
  channel    text,
  applied_on date,
  status     text NOT NULL DEFAULT '已投递',
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS applications_owner_idx ON applications (owner, updated_at DESC);

CREATE TABLE IF NOT EXISTS tpl_professions (
  slug       text PRIMARY KEY,
  title      text NOT NULL,
  industry   text NOT NULL DEFAULT '通用',
  summary    text,
  sections   jsonb NOT NULL DEFAULT '[]'::jsonb,
  sample     jsonb NOT NULL DEFAULT '{}'::jsonb,
  theme      jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort       int  NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tpl_glossary (
  id         text PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  profession text NOT NULL,
  kind       text NOT NULL,
  text       text NOT NULL,
  weight     int  NOT NULL DEFAULT 5,
  source     text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tpl_glossary_prof_idx ON tpl_glossary (profession, kind);
CREATE UNIQUE INDEX IF NOT EXISTS tpl_glossary_uniq ON tpl_glossary (profession, kind, md5(text));

CREATE TABLE IF NOT EXISTS tpl_meta (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shares (
  code        text PRIMARY KEY,
  owner       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id   text NOT NULL,
  pass_salt   text,
  pass_hash   text,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shares_owner_idx ON shares (owner, created_at DESC);

-- 自托管（直连 Postgres）时按需放开注释；Supabase 下 anon 角色已有默认授权。
-- GRANT USAGE ON SCHEMA public TO anon, authenticated;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
