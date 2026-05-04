import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImagePrompt, IMAGE_STYLE_PREAMBLE } from "./image-prompt.ts";

test("buildImagePrompt ends with the house-style preamble", () => {
  // Image models weight the front of the prompt more heavily, so the
  // food leads and the styling preamble trails.
  const prompt = buildImagePrompt({
    title: "Bobotie",
    subtitle: null,
    imageDescription: null,
  });
  assert.ok(
    prompt.endsWith(IMAGE_STYLE_PREAMBLE),
    "preamble must trail the prompt",
  );
});

test("buildImagePrompt appends title when no subtitle and no description", () => {
  const prompt = buildImagePrompt({
    title: "Bobotie",
    subtitle: null,
    imageDescription: null,
  });
  assert.match(prompt, /Bobotie/);
});

test("buildImagePrompt appends title + subtitle when both present and no description", () => {
  const prompt = buildImagePrompt({
    title: "Bobotie",
    subtitle: "South African spiced mince bake with a creamy egg custard topping",
    imageDescription: null,
  });
  assert.match(prompt, /Bobotie/);
  assert.match(prompt, /South African spiced mince bake/);
});

test("buildImagePrompt trims whitespace and ignores empty subtitles", () => {
  const a = buildImagePrompt({
    title: "  Bobotie  ",
    subtitle: "   ",
    imageDescription: null,
  });
  const b = buildImagePrompt({
    title: "Bobotie",
    subtitle: null,
    imageDescription: null,
  });
  assert.equal(a, b, "whitespace-only subtitle should behave like null");
});

test("buildImagePrompt does not produce double-spaces or trailing whitespace", () => {
  const prompt = buildImagePrompt({
    title: "Gnocchi with Mushrooms",
    subtitle: "Spinach and walnut, 30-minute weeknight",
    imageDescription: null,
  });
  assert.doesNotMatch(prompt, /  /, "no double spaces");
  assert.equal(prompt, prompt.trim(), "no leading/trailing whitespace");
});

test("buildImagePrompt prefers imageDescription over subtitle when both present", () => {
  const prompt = buildImagePrompt({
    title: "Bobotie",
    subtitle: "South African spiced mince bake",
    imageDescription:
      "a square of golden-brown spiced mince topped with a glossy yellow egg custard, two bay leaves on top",
  });
  assert.match(prompt, /Bobotie/);
  assert.match(prompt, /golden-brown spiced mince/, "image description must appear");
  assert.doesNotMatch(
    prompt,
    /South African spiced mince bake/,
    "subtitle must NOT appear when imageDescription is set",
  );
});

test("buildImagePrompt uses imageDescription even when subtitle is null", () => {
  const prompt = buildImagePrompt({
    title: "Bobotie",
    subtitle: null,
    imageDescription: "a square of golden-brown spiced mince",
  });
  assert.match(prompt, /Bobotie/);
  assert.match(prompt, /golden-brown spiced mince/);
});

test("buildImagePrompt treats whitespace-only imageDescription as absent", () => {
  const a = buildImagePrompt({
    title: "Bobotie",
    subtitle: "South African spiced mince bake",
    imageDescription: "   ",
  });
  const b = buildImagePrompt({
    title: "Bobotie",
    subtitle: "South African spiced mince bake",
    imageDescription: null,
  });
  assert.equal(a, b);
});
