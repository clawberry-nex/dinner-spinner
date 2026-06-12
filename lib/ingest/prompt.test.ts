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

test("documents the section field and methodRefs", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(/section/i.test(p));
  assert.ok(p.includes("methodRefs"));
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
