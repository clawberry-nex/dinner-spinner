import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePlanEntry, parsePlan } from "./plan-storage.ts";

test("normalizePlanEntry keeps id+servings and a valid day", () => {
  assert.deepEqual(normalizePlanEntry({ id: 3, servings: 2, day: 1 }), { id: 3, servings: 2, day: 1 });
});

test("normalizePlanEntry drops an invalid day but keeps the entry", () => {
  assert.deepEqual(normalizePlanEntry({ id: 3, servings: 2, day: 9 }), { id: 3, servings: 2 });
});

test("normalizePlanEntry rejects non-entries", () => {
  assert.equal(normalizePlanEntry({ servings: 2 }), null);
  assert.equal(normalizePlanEntry(null), null);
  assert.equal(normalizePlanEntry("x"), null);
});

test("parsePlan filters junk and returns [] on bad input", () => {
  assert.deepEqual(parsePlan(JSON.stringify([{ id: 1, servings: 4 }, { bad: true }])), [{ id: 1, servings: 4 }]);
  assert.deepEqual(parsePlan(null), []);
  assert.deepEqual(parsePlan("not json"), []);
  assert.deepEqual(parsePlan(JSON.stringify({ not: "array" })), []);
});
