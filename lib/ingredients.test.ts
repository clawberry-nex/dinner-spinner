import { test } from "node:test";
import assert from "node:assert/strict";
import { groupKey, splicePantryToShopping, type ShoppingGroup } from "./ingredients.ts";

function g(name: string, descriptor: string | null = null): ShoppingGroup {
  return { name, descriptor, items: [] };
}

test("groupKey lowercases and trims name and descriptor", () => {
  assert.equal(groupKey({ name: "Garlic", descriptor: null }), groupKey({ name: "garlic", descriptor: "" }));
  assert.equal(groupKey({ name: "  Tomato  ", descriptor: "Ripe" }), groupKey({ name: "tomato", descriptor: "ripe" }));
});

test("groupKey distinguishes by descriptor", () => {
  assert.notEqual(
    groupKey({ name: "tomato", descriptor: "cherry" }),
    groupKey({ name: "tomato", descriptor: null }),
  );
});

test("splicePantryToShopping is identity when set is empty", () => {
  const shopping = [g("apple")];
  const pantry = [g("salt"), g("pepper")];
  const result = splicePantryToShopping(shopping, pantry, new Set());
  assert.equal(result.shopping, shopping);
  assert.equal(result.pantry, pantry);
});

test("splicePantryToShopping moves a single matching pantry group to shopping", () => {
  const shopping = [g("apple")];
  const pantry = [g("salt"), g("garlic"), g("pepper")];
  const result = splicePantryToShopping(
    shopping,
    pantry,
    new Set([groupKey(g("garlic"))]),
  );
  assert.deepEqual(
    result.shopping.map((s) => s.name),
    ["apple", "garlic"],
  );
  assert.deepEqual(
    result.pantry.map((p) => p.name),
    ["salt", "pepper"],
  );
});

test("splicePantryToShopping keeps shopping list sorted alphabetically after splice", () => {
  const shopping = [g("banana"), g("zucchini")];
  const pantry = [g("apple"), g("salt")];
  const result = splicePantryToShopping(
    shopping,
    pantry,
    new Set([groupKey(g("apple"))]),
  );
  assert.deepEqual(
    result.shopping.map((s) => s.name),
    ["apple", "banana", "zucchini"],
  );
});

test("splicePantryToShopping ignores keys that don't match any pantry group", () => {
  const shopping = [g("apple")];
  const pantry = [g("salt")];
  const result = splicePantryToShopping(
    shopping,
    pantry,
    new Set([groupKey(g("cumin"))]),
  );
  // No groups moved → returns originals untouched.
  assert.equal(result.shopping, shopping);
  assert.equal(result.pantry, pantry);
});

test("splicePantryToShopping respects descriptor when keying", () => {
  const shopping: ShoppingGroup[] = [];
  const pantry = [g("tomato", "cherry"), g("tomato", null)];
  // Mark only the descriptor-less tomato as out — cherry tomato stays.
  const result = splicePantryToShopping(
    shopping,
    pantry,
    new Set([groupKey(g("tomato", null))]),
  );
  assert.deepEqual(
    result.shopping.map((s) => `${s.name}/${s.descriptor ?? ""}`),
    ["tomato/"],
  );
  assert.deepEqual(
    result.pantry.map((p) => `${p.name}/${p.descriptor ?? ""}`),
    ["tomato/cherry"],
  );
});
