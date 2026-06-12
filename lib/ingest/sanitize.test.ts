import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceMethodRefs, normalizeEscapedWhitespace } from "./sanitize.ts";

test("coerces a JSON-string methodRefs into an array", () => {
  const raw: Record<string, unknown> = {
    methodRefs: JSON.stringify([{ phrase: "the dough", ingredients: [0, 1] }]),
  };
  coerceMethodRefs(raw);
  assert.ok(Array.isArray(raw.methodRefs));
  assert.equal((raw.methodRefs as unknown[]).length, 1);
});

test("drops methodRefs when it is a non-array, non-string value", () => {
  const raw: Record<string, unknown> = { methodRefs: 42 };
  coerceMethodRefs(raw);
  assert.equal("methodRefs" in raw, false);
});

test("drops a non-JSON string methodRefs", () => {
  const raw: Record<string, unknown> = { methodRefs: "not json" };
  coerceMethodRefs(raw);
  assert.equal("methodRefs" in raw, false);
});

test("drops individually-invalid entries, keeps the valid ones", () => {
  const longPhrase = "x".repeat(161); // > MethodRefSchema phrase max (160)
  const raw: Record<string, unknown> = {
    methodRefs: [
      { phrase: "the sauce", ingredients: [0] }, // valid
      { phrase: longPhrase, ingredients: [1] }, // phrase too long
      { phrase: "the spices", ingredients: [] }, // empty ingredients
      { phrase: "the dough", ingredients: [2, 3] }, // valid
      { ingredients: [4] }, // missing phrase
    ],
  };
  coerceMethodRefs(raw);
  const refs = raw.methodRefs as Array<{ phrase: string }>;
  assert.equal(refs.length, 2);
  assert.deepEqual(
    refs.map((m) => m.phrase),
    ["the sauce", "the dough"],
  );
});

test("leaves a fully-valid array intact", () => {
  const raw: Record<string, unknown> = {
    methodRefs: [{ phrase: "the dough", ingredients: [0, 1] }],
  };
  coerceMethodRefs(raw);
  assert.equal((raw.methodRefs as unknown[]).length, 1);
});

test("no-ops on null / undefined / non-object", () => {
  assert.doesNotThrow(() => coerceMethodRefs(null));
  assert.doesNotThrow(() => coerceMethodRefs(undefined));
  assert.doesNotThrow(() => coerceMethodRefs("str"));
});

// Regression: the exact failure that produced "Parsed dish failed validation" —
// Haiku emitted a 93-char enumeration phrase, over the old max(80). It is now
// valid (<=160) and kept rather than sinking the whole import.
test("keeps a 93-char enumeration phrase (the reported regression)", () => {
  const phrase =
    "the lime leaves, shallots, lemongrass, galangal, fish sauce, lime juice, palm sugar and chilli";
  const raw: Record<string, unknown> = {
    methodRefs: [{ phrase, ingredients: [0, 1, 2, 3] }],
  };
  coerceMethodRefs(raw);
  assert.equal((raw.methodRefs as unknown[]).length, 1);
});

// ---------------------------------------------------------------------------
// normalizeEscapedWhitespace — Haiku's structured output nondeterministically
// returns `recipe` (and other text fields) with LITERAL backslash-n instead of
// real newlines, which parseMethod can't split (a `## Section`-leading method
// then collapses into one heading → renders as no method). Repair it at ingest.
// ---------------------------------------------------------------------------

test("converts literal backslash-n in recipe to a real newline", () => {
  const raw: Record<string, unknown> = { recipe: "## Main\\n\\n1. Step one\\n2. Step two" };
  normalizeEscapedWhitespace(raw);
  assert.equal(raw.recipe, "## Main\n\n1. Step one\n2. Step two");
});

test("converts literal backslash-r-backslash-n (CRLF) to a single newline", () => {
  const raw: Record<string, unknown> = { recipe: "1. a\\r\\n2. b" };
  normalizeEscapedWhitespace(raw);
  assert.equal(raw.recipe, "1. a\n2. b");
});

test("leaves a recipe with real newlines unchanged", () => {
  const good = "## Filling\n\n1. Heat the oil\n2. Add onion";
  const raw: Record<string, unknown> = { recipe: good };
  normalizeEscapedWhitespace(raw);
  assert.equal(raw.recipe, good);
});

test("normalizes subtitle and per-ingredient preparation/descriptor/section", () => {
  const raw: Record<string, unknown> = {
    subtitle: "a\\ncozy soup",
    ingredients: [
      { name: "onion", preparation: "finely\\nchopped", descriptor: "large\\nish", section: "Base\\n" },
    ],
  };
  normalizeEscapedWhitespace(raw);
  assert.equal(raw.subtitle, "a\ncozy soup");
  const ing = (raw.ingredients as Array<Record<string, unknown>>)[0];
  assert.equal(ing.preparation, "finely\nchopped");
  assert.equal(ing.descriptor, "large\nish");
  assert.equal(ing.section, "Base\n");
});

test("no-ops on null / undefined / non-object / missing fields", () => {
  assert.doesNotThrow(() => normalizeEscapedWhitespace(null));
  assert.doesNotThrow(() => normalizeEscapedWhitespace(undefined));
  assert.doesNotThrow(() => normalizeEscapedWhitespace("str"));
  const raw: Record<string, unknown> = { title: "Soup" };
  normalizeEscapedWhitespace(raw);
  assert.equal(raw.title, "Soup");
});
