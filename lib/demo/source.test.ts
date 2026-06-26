import { test } from "node:test";
import assert from "node:assert/strict";
import { filterDishesByTags, deriveTags } from "./source.ts";
import type { Dish } from "../types.ts";

function dish(id: number, title: string, tags: string[]): Dish {
  return {
    id, title, subtitle: null, recipe: null, tags, ingredients: [],
    baseServings: 4, favorite: false, imageUrl: null, emoji: null, accent: null,
    notes: null, imageDescription: null, public: true, lastCookedAt: null,
    averageRating: null, ratingCount: 0, cookCount: 0,
    createdAt: "2026-01-01", updatedAt: "2026-01-01",
  };
}
const dishes = [
  dish(1, "Zucchini Bake", ["vegetarian", "quick"]),
  dish(2, "Aloo Gobi", ["vegetarian", "indian"]),
  dish(3, "Beef Stew", ["meat"]),
];

test("no tags returns all, sorted by title", () => {
  assert.deepEqual(filterDishesByTags(dishes, []).map((d) => d.title), ["Aloo Gobi", "Beef Stew", "Zucchini Bake"]);
});

test("tags use AND-semantics (must contain every tag)", () => {
  assert.deepEqual(filterDishesByTags(dishes, ["vegetarian"]).map((d) => d.id), [2, 1]);
  assert.deepEqual(filterDishesByTags(dishes, ["vegetarian", "indian"]).map((d) => d.id), [2]);
  assert.deepEqual(filterDishesByTags(dishes, ["vegetarian", "meat"]), []);
});

test("blank tags are ignored", () => {
  assert.equal(filterDishesByTags(dishes, ["  "]).length, 3);
});

test("deriveTags returns the sorted union", () => {
  assert.deepEqual(deriveTags(dishes), ["indian", "meat", "quick", "vegetarian"]);
});
