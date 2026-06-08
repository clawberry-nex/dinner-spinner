import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceMethodRefs } from "./sanitize.ts";

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
