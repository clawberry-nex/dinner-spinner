import { test } from "node:test";
import assert from "node:assert/strict";
import { rowToDish } from "./types.ts";

// Minimal raw dish row as the neon driver hands it back. Note bigint COUNT(*)
// columns arrive as strings, not numbers.
const baseRow: Record<string, unknown> = {
  id: 1,
  title: "Test",
  base_servings: 4,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

test("rowToDish exposes cookCount from cook_count, coercing the bigint string", () => {
  const dish = rowToDish({ ...baseRow, cook_count: "7" });
  assert.equal(dish.cookCount, 7);
});

test("rowToDish defaults cookCount to 0 when cook_count is absent", () => {
  const dish = rowToDish({ ...baseRow });
  assert.equal(dish.cookCount, 0);
});
