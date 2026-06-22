import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMethod,
  groupIngredientsBySection,
  findNameSpans,
  escapeRegex,
} from "./recipe.ts";

// ---- parseMethod ----
test("groups numbered steps under ## section headers", () => {
  const md = "## Dough\n1. Mix\n2. Knead\n## Filling\n1. Chop\n2. Fry";
  const out = parseMethod(md);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, "Dough");
  assert.deepEqual(out[0].steps, ["Mix", "Knead"]);
  assert.equal(out[1].title, "Filling");
  assert.deepEqual(out[1].steps, ["Chop", "Fry"]);
});

// Regression (batch-import stress test, 2026-06-11): Haiku returned `recipe`
// with LITERAL backslash-n instead of real newlines, so a `## Section`-leading
// method collapsed into one heading with zero steps → rendered as "no method"
// (e.g. "Christmas Duck + Potatoes"). parseMethod must tolerate literal \n.
test("tolerates literal backslash-n (renders the same as real newlines)", () => {
  const md = "## Main\\n1. Arrange the shelves\\n2. Layer the potatoes\\n## Sauce\\n1. Boil";
  const out = parseMethod(md);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, "Main");
  assert.deepEqual(out[0].steps, ["Arrange the shelves", "Layer the potatoes"]);
  assert.equal(out[1].title, "Sauce");
  assert.deepEqual(out[1].steps, ["Boil"]);
});

test("treats prose paragraphs as steps (no-header recipes get numbered)", () => {
  const md = "Heat the pan.\n\nAdd the onion.";
  const out = parseMethod(md);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, null);
  assert.deepEqual(out[0].steps, ["Heat the pan.", "Add the onion."]);
});

test("handles bulleted lists and an implicit leading section", () => {
  const md = "- step one\n- step two";
  const out = parseMethod(md);
  assert.equal(out[0].title, null);
  assert.deepEqual(out[0].steps, ["step one", "step two"]);
});

test("drops empty sections", () => {
  const md = "## Empty\n## Real\n1. do it";
  const out = parseMethod(md);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Real");
});

// ---- groupIngredientsBySection ----
const get = (x: { section?: string | null }) => x.section ?? null;

test("groups by section in first-seen order, null section trails last", () => {
  const items = [
    { name: "flour", section: "Dough" },
    { name: "tomato", section: "Filling" },
    { name: "water", section: "Dough" },
    { name: "salt", section: null },
  ];
  const groups = groupIngredientsBySection(items, get);
  assert.deepEqual(groups.map((g) => g.title), ["Dough", "Filling", null]);
  assert.deepEqual(groups[0].items.map((i) => i.index), [0, 2]);
  assert.equal(groups[0].items[0].item.name, "flour");
  assert.deepEqual(groups[2].items.map((i) => i.index), [3]);
});

test("all-unsectioned → a single null-title group (flat, back-compat)", () => {
  const items = [{ name: "a" }, { name: "b" }];
  const groups = groupIngredientsBySection(items, get);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, null);
  assert.deepEqual(groups[0].items.map((i) => i.index), [0, 1]);
});

test("treats empty-string section as null", () => {
  const items = [{ name: "a", section: "  " }];
  const groups = groupIngredientsBySection(items, get);
  assert.equal(groups[0].title, null);
});

// ---- span finders ----
test("findNameSpans matches literal ingredient names (case/plural insensitive)", () => {
  const spans = findNameSpans("Chop the Onions and garlic", [
    { name: "onion" },
    { name: "garlic" },
  ]);
  const byIdx = spans.map((s) => s.idxs[0]).sort();
  assert.deepEqual(byIdx, [0, 1]);
});

test("escapeRegex escapes regex metacharacters", () => {
  assert.equal(escapeRegex("a.b+c(d)"), "a\\.b\\+c\\(d\\)");
});
