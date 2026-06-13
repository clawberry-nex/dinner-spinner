import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sortDishes,
  availableSortOptions,
  isSortKey,
  SORT_OPTIONS,
  DEFAULT_SORT,
  type SortableDish,
  type SortKey,
} from "./dish-sort.ts";

// Minimal SortableDish factory — every field defaulted so each test sets only
// the dimension it exercises.
function d(id: number, over: Partial<SortableDish> = {}): SortableDish {
  return {
    id,
    title: `Dish ${id}`,
    favorite: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastCookedAt: null,
    averageRating: null,
    ratingCount: 0,
    cookCount: 0,
    ...over,
  };
}

const ids = (ds: SortableDish[]) => ds.map((x) => x.id);

test("recent: newest createdAt first", () => {
  const out = sortDishes(
    [
      d(1, { createdAt: "2026-01-01T00:00:00Z" }),
      d(2, { createdAt: "2026-06-01T00:00:00Z" }),
      d(3, { createdAt: "2026-03-01T00:00:00Z" }),
    ],
    "recent",
  );
  assert.deepEqual(ids(out), [2, 3, 1]);
});

test("oldest: oldest createdAt first", () => {
  const out = sortDishes(
    [
      d(1, { createdAt: "2026-01-01T00:00:00Z" }),
      d(2, { createdAt: "2026-06-01T00:00:00Z" }),
      d(3, { createdAt: "2026-03-01T00:00:00Z" }),
    ],
    "oldest",
  );
  assert.deepEqual(ids(out), [1, 3, 2]);
});

test("name: A–Z, case-insensitive and numeric-aware", () => {
  const out = sortDishes(
    [
      d(1, { title: "banana split" }),
      d(2, { title: "Apple pie" }),
      d(3, { title: "Dish 10" }),
      d(4, { title: "Dish 2" }),
    ],
    "name",
  );
  // case-insensitive: Apple < banana; numeric: "Dish 2" < "Dish 10"
  assert.deepEqual(ids(out), [2, 1, 4, 3]);
});

test("cooked-most: highest total cook count first", () => {
  const out = sortDishes(
    [
      d(1, { cookCount: 2 }),
      d(2, { cookCount: 9 }),
      d(3, { cookCount: 5 }),
    ],
    "cooked-most",
  );
  assert.deepEqual(ids(out), [2, 3, 1]);
});

test("cooked-recent: most recently cooked first, never-cooked last", () => {
  const out = sortDishes(
    [
      d(1, { lastCookedAt: null }),
      d(2, { lastCookedAt: "2026-06-01T00:00:00Z" }),
      d(3, { lastCookedAt: "2026-02-01T00:00:00Z" }),
    ],
    "cooked-recent",
  );
  assert.deepEqual(ids(out), [2, 3, 1]);
});

test("rating: highest average first, unrated last, tiebreak by rating count", () => {
  const out = sortDishes(
    [
      d(1, { averageRating: null }),
      d(2, { averageRating: 4, ratingCount: 3 }),
      d(3, { averageRating: 5, ratingCount: 1 }),
      d(4, { averageRating: 4, ratingCount: 9 }),
    ],
    "rating",
  );
  // 5★ first; the two 4★ ordered by rating count desc (9 before 3); unrated last.
  assert.deepEqual(ids(out), [3, 4, 2, 1]);
});

test("suggested: favorites first, then recently cooked, never-cooked last", () => {
  const out = sortDishes(
    [
      d(1, { favorite: false, lastCookedAt: null }),
      d(2, { favorite: true, lastCookedAt: "2026-01-01T00:00:00Z" }),
      d(3, { favorite: true, lastCookedAt: "2026-06-01T00:00:00Z" }),
      d(4, { favorite: false, lastCookedAt: "2026-03-01T00:00:00Z" }),
    ],
    "suggested",
  );
  assert.deepEqual(ids(out), [3, 2, 4, 1]);
});

test("suggested: ties broken by id descending (newest id first)", () => {
  const out = sortDishes([d(1), d(5), d(3)], "suggested");
  assert.deepEqual(ids(out), [5, 3, 1]);
});

test("name: ties broken by id ascending", () => {
  const out = sortDishes(
    [d(7, { title: "same" }), d(2, { title: "same" }), d(4, { title: "same" })],
    "name",
  );
  assert.deepEqual(ids(out), [2, 4, 7]);
});

test("sortDishes does not mutate its input and returns a new array", () => {
  const input = [d(1, { cookCount: 1 }), d(2, { cookCount: 9 })];
  const snapshot = ids(input);
  const out = sortDishes(input, "cooked-most");
  assert.notEqual(out, input, "should return a new array");
  assert.deepEqual(ids(input), snapshot, "input order must be unchanged");
  assert.deepEqual(ids(out), [2, 1]);
});

test("empty input returns an empty array", () => {
  assert.deepEqual(sortDishes([], "recent"), []);
});

test("availableSortOptions(false) excludes owner-only sorts", () => {
  const keys = availableSortOptions(false).map((o) => o.key);
  for (const ownerOnly of ["cooked-most", "cooked-recent", "rating"] as SortKey[]) {
    assert.ok(!keys.includes(ownerOnly), `visitor must not see ${ownerOnly}`);
  }
  assert.ok(keys.includes("suggested"));
  assert.ok(keys.includes("recent"));
  assert.ok(keys.includes("name"));
});

test("availableSortOptions(true) includes every sort option", () => {
  const keys = availableSortOptions(true).map((o) => o.key);
  assert.deepEqual(keys.sort(), SORT_OPTIONS.map((o) => o.key).sort());
});

test("isSortKey validates membership", () => {
  assert.equal(isSortKey("recent"), true);
  assert.equal(isSortKey("rating"), true);
  assert.equal(isSortKey("nonsense"), false);
  assert.equal(isSortKey(""), false);
  assert.equal(isSortKey(null), false);
  assert.equal(isSortKey(undefined), false);
});

test("DEFAULT_SORT is a shared (non-owner-only) sort", () => {
  assert.equal(DEFAULT_SORT, "suggested");
  const def = SORT_OPTIONS.find((o) => o.key === DEFAULT_SORT);
  assert.ok(def && !def.ownerOnly, "default must be available to visitors too");
});
