CREATE TABLE IF NOT EXISTS dishes (
  id            serial PRIMARY KEY,
  title         text NOT NULL,
  subtitle      text,
  recipe        text,
  tags          text[] NOT NULL DEFAULT '{}',
  ingredients   jsonb  NOT NULL DEFAULT '[]',
  base_servings int    NOT NULL DEFAULT 4,
  favorite      boolean NOT NULL DEFAULT false,
  image_url     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dishes_tags_gin ON dishes USING gin (tags);

-- Backward-compatible adds for existing installs.
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS favorite boolean NOT NULL DEFAULT false;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS image_url text;

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
-- response includes the most-recent cooked_at via a LATERAL subquery so
-- the spinner can de-weight recently-cooked dishes.
CREATE TABLE IF NOT EXISTS cook_log (
  id         serial PRIMARY KEY,
  dish_id    int NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  cooked_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cook_log_dish_id_cooked_at_idx
  ON cook_log (dish_id, cooked_at DESC);
