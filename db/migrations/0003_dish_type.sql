ALTER TABLE dishes ADD COLUMN IF NOT EXISTS dish_type text NOT NULL DEFAULT 'main'
  CHECK (dish_type IN ('main', 'side', 'other'));
