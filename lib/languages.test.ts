import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_LANGUAGES, languageName, isSupportedLanguage } from "./languages.ts";

test("English is the default for null/unknown codes", () => {
  assert.equal(languageName(null), "English");
  assert.equal(languageName(undefined), "English");
  assert.equal(languageName("zz"), "English");
});

test("maps known codes to names", () => {
  assert.equal(languageName("nl"), "Dutch");
  assert.equal(languageName("de"), "German");
  assert.equal(languageName("EN"), "English"); // case-insensitive
  assert.equal(languageName(" nl "), "Dutch"); // trimmed
});

test("the list includes English first and is non-empty", () => {
  assert.equal(SUPPORTED_LANGUAGES.length, 6);
  assert.equal(SUPPORTED_LANGUAGES[0].code, "en");
});

test("isSupportedLanguage accepts null (means default) and known codes only", () => {
  assert.equal(isSupportedLanguage(null), true);
  assert.equal(isSupportedLanguage(undefined), true);
  assert.equal(isSupportedLanguage(" en "), true); // trimmed
  assert.equal(isSupportedLanguage("nl"), true);
  assert.equal(isSupportedLanguage("zz"), false);
});
