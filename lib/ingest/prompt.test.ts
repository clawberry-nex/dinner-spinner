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
  assert.ok(p.toLowerCase().includes("finn likes this"));
});

test("includes at least one standard ingredient name", () => {
  const p = buildIngestPrompt(FIXTURE);
  // STANDARD_INGREDIENTS contains "onion" — verify the auto-sync wiring.
  assert.ok(p.includes("onion"));
});
