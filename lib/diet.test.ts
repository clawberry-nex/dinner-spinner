import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDietFlags, formatDietChips } from "./diet.ts";
import type { Ingredient } from "./types.ts";

function ing(name: string, extra: Partial<Ingredient> = {}): Ingredient {
  return { quantity: 1, name, ...extra };
}

test("empty list is vegan + vegetarian with no allergens", () => {
  const f = computeDietFlags([]);
  assert.equal(f.vegetarian, true);
  assert.equal(f.vegan, true);
  assert.equal(f.contains.size, 0);
});

test("beef mince kills vegetarian and vegan", () => {
  const f = computeDietFlags([ing("beef mince")]);
  assert.equal(f.vegetarian, false);
  assert.equal(f.vegan, false);
});

test("chicken thigh kills vegetarian and vegan", () => {
  const f = computeDietFlags([ing("chicken thigh")]);
  assert.equal(f.vegetarian, false);
  assert.equal(f.vegan, false);
});

test("egg is vegetarian but not vegan", () => {
  const f = computeDietFlags([ing("egg")]);
  assert.equal(f.vegetarian, true);
  assert.equal(f.vegan, false);
  assert.ok(f.contains.has("eggs"));
});

test("milk/butter/cheese → vegetarian, not vegan, contains dairy", () => {
  for (const name of ["milk", "butter", "cheddar", "feta", "cream"]) {
    const f = computeDietFlags([ing(name)]);
    assert.equal(f.vegetarian, true, `${name} should be vegetarian`);
    assert.equal(f.vegan, false, `${name} should not be vegan`);
    assert.ok(f.contains.has("dairy"), `${name} should contain dairy`);
  }
});

test("almond → vegan, contains nuts", () => {
  const f = computeDietFlags([ing("almond")]);
  assert.equal(f.vegan, true);
  assert.ok(f.contains.has("nuts"));
});

test("plain flour → vegan, contains gluten", () => {
  const f = computeDietFlags([ing("plain flour")]);
  assert.equal(f.vegan, true);
  assert.ok(f.contains.has("gluten"));
});

test("cod → not vegetarian, contains fish", () => {
  const f = computeDietFlags([ing("cod")]);
  assert.equal(f.vegetarian, false);
  assert.ok(f.contains.has("fish"));
});

test("prawn → not vegetarian, contains shellfish", () => {
  const f = computeDietFlags([ing("prawn")]);
  assert.equal(f.vegetarian, false);
  assert.ok(f.contains.has("shellfish"));
});

test("soy sauce → contains soy AND gluten (classic trap)", () => {
  const f = computeDietFlags([ing("soy sauce")]);
  assert.equal(f.vegan, true);
  assert.ok(f.contains.has("soy"), "should flag soy");
  assert.ok(f.contains.has("gluten"), "soy sauce has wheat → gluten");
});

test("tofu → vegan, contains soy", () => {
  const f = computeDietFlags([ing("tofu")]);
  assert.equal(f.vegan, true);
  assert.ok(f.contains.has("soy"));
});

test("honey is not vegan", () => {
  const f = computeDietFlags([ing("honey")]);
  assert.equal(f.vegetarian, true);
  assert.equal(f.vegan, false);
});

test("unknown ingredient is permissive (not a meat flag)", () => {
  const f = computeDietFlags([ing("gochujang")]);
  assert.equal(f.vegetarian, true);
  assert.equal(f.vegan, true);
});

test("substring hit — unknown 'beef stock' downgrades to non-vegetarian", () => {
  const f = computeDietFlags([ing("beef stock")]);
  assert.equal(f.vegetarian, false);
});

test("substring hit — unknown 'chicken stock cube' → non-veg", () => {
  const f = computeDietFlags([ing("chicken stock cube")]);
  assert.equal(f.vegetarian, false);
});

test("alias — plural chickpeas collapses to chickpea", () => {
  const f = computeDietFlags([ing("chickpeas")]);
  assert.equal(f.vegan, true);
});

test("alias — hazelnuts → nuts", () => {
  const f = computeDietFlags([ing("hazelnuts")]);
  assert.ok(f.contains.has("nuts"));
});

test("mixed: chicken + butter kills both, flags dairy", () => {
  const f = computeDietFlags([ing("chicken thigh"), ing("butter")]);
  assert.equal(f.vegetarian, false);
  assert.equal(f.vegan, false);
  assert.ok(f.contains.has("dairy"));
});

test("optional ingredients still count for classification", () => {
  const f = computeDietFlags([
    ing("onion"),
    ing("chicken thigh", { optional: true }),
  ]);
  assert.equal(f.vegetarian, false);
});

test("pantry ingredients still count (soy sauce in pantry still flags soy)", () => {
  const f = computeDietFlags([
    ing("onion"),
    ing("soy sauce", { pantry: true }),
  ]);
  assert.ok(f.contains.has("soy"));
});

test("name is normalised (case/whitespace)", () => {
  const f = computeDietFlags([ing("  BEEF Mince  ")]);
  assert.equal(f.vegetarian, false);
});

test("all-vegan plant-based dish comes out clean", () => {
  const f = computeDietFlags([
    ing("onion"),
    ing("garlic"),
    ing("tomato"),
    ing("olive oil", { pantry: true }),
    ing("basil"),
    ing("salt", { pantry: true }),
  ]);
  assert.equal(f.vegetarian, true);
  assert.equal(f.vegan, true);
  assert.equal(f.contains.size, 0);
});

test("lentils + rice = vegan protein plate", () => {
  const f = computeDietFlags([ing("lentil"), ing("basmati rice")]);
  assert.equal(f.vegan, true);
  assert.equal(f.contains.size, 0);
});

test("formatDietChips returns primary diet + allergens", () => {
  const flags = computeDietFlags([ing("egg"), ing("milk"), ing("plain flour")]);
  const chips = formatDietChips(flags);
  const labels = chips.map((c) => c.label);
  assert.ok(labels.includes("vegetarian"));
  assert.ok(labels.includes("contains dairy"));
  assert.ok(labels.includes("contains eggs"));
  assert.ok(labels.includes("contains gluten"));
  assert.ok(!labels.includes("vegan"), "should not promote to vegan");
});

test("formatDietChips: vegan dish gets vegan chip (not vegetarian)", () => {
  const flags = computeDietFlags([ing("lentil"), ing("basmati rice")]);
  const chips = formatDietChips(flags);
  const labels = chips.map((c) => c.label);
  assert.ok(labels.includes("vegan"));
  assert.ok(!labels.includes("vegetarian"), "vegan supersedes vegetarian chip");
});

test("formatDietChips: meat dish shows no diet chip, still shows allergens", () => {
  const flags = computeDietFlags([ing("chicken thigh"), ing("butter")]);
  const chips = formatDietChips(flags);
  const labels = chips.map((c) => c.label);
  assert.ok(!labels.includes("vegetarian"));
  assert.ok(!labels.includes("vegan"));
  assert.ok(labels.includes("contains dairy"));
});
