import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImagePrompt, IMAGE_STYLE_PREAMBLE } from "./image-prompt.ts";

test("buildImagePrompt always starts with the house-style preamble", () => {
  const prompt = buildImagePrompt({ title: "Bobotie", subtitle: null });
  assert.ok(prompt.startsWith(IMAGE_STYLE_PREAMBLE), "preamble must lead the prompt");
});

test("buildImagePrompt appends title when no subtitle", () => {
  const prompt = buildImagePrompt({ title: "Bobotie", subtitle: null });
  assert.match(prompt, /Bobotie/);
});

test("buildImagePrompt appends title + subtitle when both present", () => {
  const prompt = buildImagePrompt({
    title: "Bobotie",
    subtitle: "South African spiced mince bake with a creamy egg custard topping",
  });
  assert.match(prompt, /Bobotie/);
  assert.match(prompt, /South African spiced mince bake/);
});

test("buildImagePrompt trims whitespace and ignores empty subtitles", () => {
  const a = buildImagePrompt({ title: "  Bobotie  ", subtitle: "   " });
  const b = buildImagePrompt({ title: "Bobotie", subtitle: null });
  assert.equal(a, b, "whitespace-only subtitle should behave like null");
});

test("buildImagePrompt does not produce double-spaces or trailing whitespace", () => {
  const prompt = buildImagePrompt({
    title: "Gnocchi with Mushrooms",
    subtitle: "Spinach and walnut, 30-minute weeknight",
  });
  assert.doesNotMatch(prompt, /  /, "no double spaces");
  assert.equal(prompt, prompt.trim(), "no leading/trailing whitespace");
});
