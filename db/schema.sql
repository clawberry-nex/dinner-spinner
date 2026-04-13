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
