CREATE TABLE IF NOT EXISTS dishes (
  id                serial PRIMARY KEY,
  title             text NOT NULL,
  subtitle          text,
  recipe            text,
  notes             text,
  tags              text[] NOT NULL DEFAULT '{}',
  ingredients       jsonb  NOT NULL DEFAULT '[]',
  base_servings     int    NOT NULL DEFAULT 4,
  favorite          boolean NOT NULL DEFAULT false,
  image_url         text,
  -- AI-generated "what the plated dish actually looks like" prompt input.
  -- When non-null, buildImagePrompt prefers this over the user-facing
  -- subtitle. Backfilled by Nex; never shown on the public dish view.
  image_description text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dishes_tags_gin ON dishes USING gin (tags);

-- Backward-compatible adds for existing installs.
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS favorite boolean NOT NULL DEFAULT false;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS emoji text;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS accent text;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS image_description text;

-- User-curated pantry defaults. Ingredient names stored lowercased.
-- applyPantryDefaults() auto-flags matching ingredients as pantry:true
-- on POST/PATCH. Seeded once from lib/vocabulary.ts::PANTRY_DEFAULTS.
CREATE TABLE IF NOT EXISTS pantry_names (
  name        text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Single-row meal plan state. Single-user app, so we keep the whole plan
-- in one jsonb row. entries is an array of {id: number, servings: number}.
CREATE TABLE IF NOT EXISTS meal_plan (
  id          int PRIMARY KEY DEFAULT 1,
  entries     jsonb NOT NULL DEFAULT '[]',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (id = 1)
);
INSERT INTO meal_plan (id, entries) VALUES (1, '[]')
  ON CONFLICT (id) DO NOTHING;

-- Per-dish cooking log. /api/cook-log POST appends a row. The dishes GET
-- response exposes most-recent cooked_at, avg_rating, and rating_count
-- via correlated subqueries so the spinner can de-weight recently-cooked
-- dishes and up-weight highly-rated ones. rating + note are captured
-- from the dish-detail "Cooked it" form.
CREATE TABLE IF NOT EXISTS cook_log (
  id         serial PRIMARY KEY,
  dish_id    int NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  cooked_at  timestamptz NOT NULL DEFAULT now(),
  rating     smallint,
  note       text,
  CONSTRAINT cook_log_rating_check CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
);
CREATE INDEX IF NOT EXISTS cook_log_dish_id_cooked_at_idx
  ON cook_log (dish_id, cooked_at DESC);

-- Backward-compatible adds for existing installs.
ALTER TABLE cook_log ADD COLUMN IF NOT EXISTS rating smallint;
ALTER TABLE cook_log ADD COLUMN IF NOT EXISTS note text;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cook_log_rating_check'
  ) THEN
    ALTER TABLE cook_log ADD CONSTRAINT cook_log_rating_check
      CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
  END IF;
END $$;

-- Multi-user auth. uuid PK via pgcrypto's gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  name            text,
  image           text,
  -- bcrypt hash. Null for OAuth-only users.
  password_hash   text,
  -- Per-user Todoist creds. Env vars are fallback for the seed owner only.
  todoist_token   text,
  todoist_project text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Add nullable user_id to every domain table. Backfill populates them;
-- a later migration (db/lockdown.sql) flips them to NOT NULL.
ALTER TABLE dishes        ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE pantry_names  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE meal_plan     ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE cook_log      ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS dishes_user_id_idx       ON dishes (user_id);
CREATE INDEX IF NOT EXISTS pantry_names_user_id_idx ON pantry_names (user_id);
CREATE INDEX IF NOT EXISTS cook_log_user_id_idx     ON cook_log (user_id);

-- Public profiles. `handle` is the slug used in /u/[handle] URLs.
-- Initially nullable so existing rows can be backfilled by
-- scripts/backfill-handles.ts; flipped to NOT NULL afterwards.
-- handle_changed_at gates the one-time rename: NULL = never changed,
-- non-NULL = locked.
ALTER TABLE users ADD COLUMN IF NOT EXISTS handle            text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio               text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS handle_changed_at timestamptz;

-- Per-dish visibility. Default true matches the public-by-default model;
-- profile pages show only public dishes to non-owners.
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS public boolean NOT NULL DEFAULT true;

-- Ingest normalization (2026-06): per-step phrase→ingredient links resolved
-- at ingest for cook-mode highlighting, and per-user default recipe language.
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS method_refs jsonb;
ALTER TABLE users  ADD COLUMN IF NOT EXISTS default_language text;

-- Async dish-image regeneration jobs (2026-06). POST /api/dishes/[id]/image
-- inserts a pending row, runs generation in after(), and flips status to
-- done/failed; the edit page polls GET .../image/jobs/[jobId]. Rows are
-- opportunistically pruned (>1 day) on each POST — no cron. gen_random_uuid()
-- comes from pgcrypto (already enabled above).
CREATE TABLE IF NOT EXISTS image_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id     int  NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending',
  image_url   text,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS image_jobs_dish_id_idx ON image_jobs (dish_id);
CREATE INDEX IF NOT EXISTS image_jobs_created_at_idx ON image_jobs (created_at);

-- Batch recipe import jobs (2026-06). POST /api/import inserts a 'detecting'
-- row and starts a claude-agent "detect" job that splits the uploaded/pasted
-- text into N recipe chunks; GET /api/import/jobs/[id] advances the state
-- machine ONE bounded step per poll (detect → parse each chunk via the
-- single-ingest claude-agent path → create dish → Gemini image batch),
-- persisting progress so the import survives navigation and resumes on return.
--   status:        detecting → detected → parsing → imaging → done (+failed)
--   chunks:        [{title, text, status, parseJobId, dishId, error}] per recipe
--   image_batches: [{name, state, applied}] Gemini batch job(s)
--   locked_until:  set while one poll advances, so two tabs can't double-advance
-- Rows are opportunistically pruned (>1 day) on each POST — no cron.
-- gen_random_uuid() comes from pgcrypto (enabled above).
CREATE TABLE IF NOT EXISTS import_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'detecting',
  detect_job_id text,
  file_name     text,
  chunks        jsonb NOT NULL DEFAULT '[]',
  image_batches jsonb NOT NULL DEFAULT '[]',
  error         text,
  locked_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS import_jobs_user_id_idx ON import_jobs (user_id);
CREATE INDEX IF NOT EXISTS import_jobs_created_at_idx ON import_jobs (created_at);
