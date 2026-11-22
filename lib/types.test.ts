import { test } from "node:test";
import assert from "node:assert/strict";
import { DishInputSchema, DishPatchSchema, rowToDish } from "./types.ts";

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

test("old rows and creates default to main, while omitted PATCH fields stay absent", () => {
  assert.equal(rowToDish(baseRow).dishType, "main");
  assert.equal(DishInputSchema.parse({ title: "Stew" }).dishType, "main");
  assert.deepEqual(DishPatchSchema.parse({ notes: "More lemon" }), { notes: "More lemon" });
});

test("create, edit, and read preserve each dish type and reject invalid input", () => {
  for (const dishType of ["main", "side", "other"]) {
    assert.equal(DishInputSchema.parse({ title: "Recipe", dishType }).dishType, dishType);
    assert.equal(DishPatchSchema.parse({ dishType }).dishType, dishType);
    assert.equal(rowToDish({ ...baseRow, dish_type: dishType }).dishType, dishType);
  }
  for (const invalid of [null, "", "invalid"]) {
    assert.equal(DishInputSchema.safeParse({ title: "Recipe", dishType: invalid }).success, false);
    assert.equal(DishPatchSchema.safeParse({ dishType: invalid }).success, false);
  }
});
