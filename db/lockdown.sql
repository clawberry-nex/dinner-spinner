-- Run AFTER scripts/backfill-seed-owner.ts has filled in every user_id.
-- This is the second-stage migration that locks down the new shape.
--
-- Usage:
--   psql "$DATABASE_URL" -f db/lockdown.sql
--
-- Wrapped in a transaction so a mid-script failure rolls back cleanly.

BEGIN;

-- Flip user_id columns to NOT NULL on every domain table.
ALTER TABLE dishes       ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE pantry_names ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE cook_log     ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE meal_plan    ALTER COLUMN user_id SET NOT NULL;

-- pantry_names: PK changes from (name) to (user_id, name) so each user
-- can have their own "salt" / "olive oil" / etc.
ALTER TABLE pantry_names DROP CONSTRAINT IF EXISTS pantry_names_pkey;
ALTER TABLE pantry_names ADD PRIMARY KEY (user_id, name);

-- meal_plan: PK becomes user_id. The legacy id column + CHECK(id=1)
-- single-row constraint go away.
ALTER TABLE meal_plan DROP CONSTRAINT IF EXISTS meal_plan_pkey;
ALTER TABLE meal_plan DROP CONSTRAINT IF EXISTS meal_plan_id_check;
ALTER TABLE meal_plan DROP COLUMN IF EXISTS id;
ALTER TABLE meal_plan ADD PRIMARY KEY (user_id);

COMMIT;
