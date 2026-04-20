import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal localStorage shim so we can exercise the parser without a DOM.
function installLocalStorageShim() {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  return store;
}

const store = installLocalStorageShim();

// Dynamic import AFTER the shim so the module's typeof-window guard
// (if any) sees localStorage defined.
const { readPlanLocal } = await import("./meal-plan.ts");

test("readPlanLocal parses legacy {id, servings} entries unchanged", () => {
  store.clear();
  store.set("mealPlan", JSON.stringify([{ id: 3, servings: 2 }]));
  const parsed = readPlanLocal();
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 3);
  assert.equal(parsed[0].servings, 2);
  assert.equal(parsed[0].day ?? null, null);
});

test("readPlanLocal preserves a valid 0..6 day", () => {
  store.clear();
  store.set(
    "mealPlan",
    JSON.stringify([
      { id: 1, servings: 2, day: 0 },
      { id: 2, servings: 4, day: 6 },
    ]),
  );
  const parsed = readPlanLocal();
  assert.equal(parsed[0].day, 0);
  assert.equal(parsed[1].day, 6);
});

test("readPlanLocal strips an out-of-range day", () => {
  store.clear();
  store.set("mealPlan", JSON.stringify([{ id: 1, servings: 2, day: 9 }]));
  const parsed = readPlanLocal();
  assert.equal(parsed[0].day ?? null, null);
});

test("readPlanLocal accepts day: null", () => {
  store.clear();
  store.set("mealPlan", JSON.stringify([{ id: 1, servings: 2, day: null }]));
  const parsed = readPlanLocal();
  assert.equal(parsed[0].day ?? null, null);
});

test("readPlanLocal rejects completely malformed entries", () => {
  store.clear();
  store.set(
    "mealPlan",
    JSON.stringify([{ id: "x", servings: 2 }, { servings: 2 }, "garbage", 42]),
  );
  const parsed = readPlanLocal();
  assert.equal(parsed.length, 0);
});
