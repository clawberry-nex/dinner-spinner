import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSharePrefillFromSearch } from "./share-prefill.ts";

test("returns the url when only url is shared", () => {
  assert.equal(buildSharePrefillFromSearch("?url=https://x.com/r"), "https://x.com/r");
});

test("joins distinct title, text, url with newlines", () => {
  assert.equal(
    buildSharePrefillFromSearch("?title=Soup&text=yum&url=https://x.com/r"),
    "Soup\nyum\nhttps://x.com/r",
  );
});

test("de-dupes when a value repeats (text === url)", () => {
  assert.equal(
    buildSharePrefillFromSearch("?text=https://x.com/r&url=https://x.com/r"),
    "https://x.com/r",
  );
});

test("ignores empty / whitespace-only params", () => {
  assert.equal(buildSharePrefillFromSearch("?title=&text=%20%20&url="), "");
});

test("returns empty string when there are no params", () => {
  assert.equal(buildSharePrefillFromSearch(""), "");
});
