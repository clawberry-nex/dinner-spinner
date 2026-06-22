import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIngestPrompt } from "./prompt.ts";

const FIXTURE = {
  userInput: "2 onions, 1 tbsp olive oil",
  pantryList: ["salt", "black pepper", "olive oil"],
};

test("includes the user input verbatim", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(p.includes("2 onions, 1 tbsp olive oil"));
});

test("renders the pantry list", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(p.includes("salt, black pepper, olive oil"));
});

test("references the submit_result tool", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(p.includes("submit_result"));
});

test("when only an image is attached, prompts to read from the image", () => {
  const p = buildIngestPrompt({
    userInput: null,
    pantryList: ["salt"],
  });
  assert.ok(p.includes("(see attached image)"));
});

test("includes core ingredient parsing rules", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(p.includes("singular"));
  assert.ok(p.includes("green chili"));
  assert.ok(/stuks.*piece/.test(p), "Dutch → English translation rule");
});

test("includes obvious-tag whitelist and forbids personal tags", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(p.includes("vegetarian"));
  assert.ok(p.toLowerCase().includes("no personal tags"));
});

test("translates all text to the target language (default English)", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(/translate/i.test(p));
  assert.ok(p.includes("English"));
  const dutch = buildIngestPrompt({ ...FIXTURE, targetLanguage: "Dutch" });
  assert.ok(dutch.includes("Dutch"));
});

test("asks for numbered steps and section headers", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(/numbered steps/i.test(p));
  assert.ok(p.includes("## "));
});

test("documents the section field and inline ingredient references", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(/section/i.test(p));
  // Inline `[label](#index)` markers replace the old methodRefs array.
  assert.ok(p.includes("[the eggs](#0)"), "shows the inline-reference example");
  assert.ok(/0-based INDEX/i.test(p), "explains the index target");
  assert.ok(p.includes("the seeds")); // loose-reference example
});

test("includes at least one standard ingredient name", () => {
  const p = buildIngestPrompt(FIXTURE);
  // STANDARD_INGREDIENTS contains "onion" — verify the auto-sync wiring.
  assert.ok(p.includes("onion"));
});

// Regression (batch-import stress test, 2026-06-11): Haiku fabricated whole
// methods/ingredients when the source had none ("The Soup I Make Every January"
// → invented "Easy Cabbage Soup" with 18 ingredients). The prompt must forbid
// inventing a method or ingredients that aren't in the input.
test("forbids inventing a method when the source has no instructions", () => {
  const p = buildIngestPrompt(FIXTURE).toLowerCase();
  assert.ok(p.includes("omit"), "should tell the model to OMIT recipe when absent");
  assert.ok(
    p.includes("never invent") || p.includes("do not invent") || p.includes("don't invent"),
    "should explicitly forbid inventing steps",
  );
});

test("forbids inventing ingredients that are not in the input", () => {
  const p = buildIngestPrompt(FIXTURE).toLowerCase();
  assert.ok(
    /(never|do not|don't) invent ingredients/.test(p),
    "should explicitly forbid inventing ingredients",
  );
});

// Systemic fidelity fixes surfaced by the langston import audit (2026-06-12).

test("optional is only for explicitly-optional ingredients, NOT 'to taste' amounts", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(/flexible quantity is not optional/i.test(p), "must say a flexible quantity is not optional");
  // the old over-broad rule (to-taste ⇒ optional) must be gone
  assert.ok(!/optional: true if the recipe says "optional", "to taste"/i.test(p));
});

test("enforces quantity & unit fidelity (no unit swaps, metric dual-units, decimal fractions)", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(/keep the source.?s? unit/i.test(p), "must say keep the source's unit");
  assert.ok(p.includes("2 lb stays 2 lb"), "must give the lb→kg counter-example");
  assert.ok(p.includes("0.375"), "must show summing a compound amount");
});

test("forbids duplicating one shared amount across several items", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(/one amount covers several/i.test(p));
});

test("does not invent a precise quantity/unit for vague sources", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(/do not invent a precise/i.test(p));
});

test("ground-truth guard extends to sections that have no steps", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(/per section too/i.test(p));
});

test("never folds the unit word into the ingredient name", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(/fold the unit into the name/i.test(p));
});
