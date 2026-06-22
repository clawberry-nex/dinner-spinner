import { test } from "node:test";
import assert from "node:assert/strict";
import { dishOgText, profileOgText } from "./meta.ts";

test("dishOgText uses subtitle when present", () => {
  const r = dishOgText({ title: "Thai Green Curry", subtitle: "Fragrant & quick", tags: ["vegetarian"], baseServings: 4 });
  assert.deepEqual(r, { title: "Thai Green Curry", description: "Fragrant & quick" });
});

test("dishOgText falls back to tags (max 3) + servings when no subtitle", () => {
  const r = dishOgText({ title: "Dal", subtitle: null, tags: ["vegan", "indian", "cheap", "extra"], baseServings: 6 });
  assert.deepEqual(r, { title: "Dal", description: "vegan · indian · cheap · serves 6" });
});

test("dishOgText with blank subtitle and no tags is just servings", () => {
  const r = dishOgText({ title: "Toast", subtitle: "   ", tags: [], baseServings: 2 });
  assert.equal(r.description, "serves 2");
});

test("profileOgText uses name + bio", () => {
  const r = profileOgText({ name: "Mirko", handle: "mirko", bio: "Home cook" }, 12);
  assert.deepEqual(r, { title: "Mirko's recipes", description: "Home cook" });
});

test("profileOgText falls back to handle and pluralizes count", () => {
  assert.deepEqual(
    profileOgText({ name: null, handle: "chef", bio: null }, 1),
    { title: "@chef", description: "1 recipe on Dinner Spinner" },
  );
  assert.equal(
    profileOgText({ name: "  ", handle: "chef", bio: "  " }, 0).description,
    "0 recipes on Dinner Spinner",
  );
});
