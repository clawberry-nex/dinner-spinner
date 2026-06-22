import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEscapedWhitespace } from "./sanitize.ts";

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
