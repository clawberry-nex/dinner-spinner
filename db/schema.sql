CREATE TABLE IF NOT EXISTS dishes (
  id            serial PRIMARY KEY,
  title         text NOT NULL,
  subtitle      text,
  recipe        text,
  tags          text[] NOT NULL DEFAULT '{}',
  ingredients   jsonb  NOT NULL DEFAULT '[]',
  base_servings int    NOT NULL DEFAULT 4,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dishes_tags_gin ON dishes USING gin (tags);

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
