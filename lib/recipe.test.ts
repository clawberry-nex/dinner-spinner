import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMethod,
  groupIngredientsBySection,
  findNameSpans,
  findPhraseSpans,
  sanitizeMethodRefs,
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

test("findPhraseSpans links loose phrases to ingredient indices", () => {
  const refs = [
    { phrase: "the seeds", ingredients: [3] },
    { phrase: "the dough", ingredients: [0, 1, 2] },
  ];
  const text = "Fry the seeds, then roll out the dough.";
  const spans = findPhraseSpans(text, refs);
  const seeds = spans.find((s) => text.slice(s.start, s.end) === "the seeds");
  const dough = spans.find((s) => text.slice(s.start, s.end) === "the dough");
  assert.deepEqual(seeds?.idxs, [3]);
  assert.deepEqual(dough?.idxs, [0, 1, 2]);
});

test("findPhraseSpans finds every occurrence of a phrase", () => {
  const refs = [{ phrase: "onion", ingredients: [0] }];
  const spans = findPhraseSpans("onion here, onion there", refs);
  assert.equal(spans.length, 2);
});

test("findPhraseSpans returns independent idxs arrays per span", () => {
  const refs = [{ phrase: "onion", ingredients: [0] }];
  const spans = findPhraseSpans("onion and onion", refs);
  assert.equal(spans.length, 2);
  assert.notEqual(spans[0].idxs, spans[1].idxs); // different array objects
  spans[0].idxs.push(99);
  assert.deepEqual(spans[1].idxs, [0]); // mutation isolated
  assert.deepEqual(refs[0].ingredients, [0]); // original ref untouched
});

test("escapeRegex escapes regex metacharacters", () => {
  assert.equal(escapeRegex("a.b+c(d)"), "a\\.b\\+c\\(d\\)");
});

// ---- sanitizeMethodRefs ----
test("sanitizeMethodRefs drops out-of-range indices and empties", () => {
  const refs = [
    { phrase: "a", ingredients: [0, 5] },
    { phrase: "b", ingredients: [9] },
    { phrase: "c", ingredients: [1, 2] },
  ];
  const out = sanitizeMethodRefs(refs, 3);
  assert.deepEqual(out, [
    { phrase: "a", ingredients: [0] },
    { phrase: "c", ingredients: [1, 2] },
  ]);
});

test("sanitizeMethodRefs returns null for null/empty input", () => {
  assert.equal(sanitizeMethodRefs(null, 3), null);
  assert.equal(sanitizeMethodRefs([], 3), null);
});
