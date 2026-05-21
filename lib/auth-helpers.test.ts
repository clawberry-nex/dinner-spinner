import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAllowlist, isEmailAllowed } from "./auth-helpers.ts";

test("parseAllowlist returns empty set when env var unset", () => {
  assert.deepEqual(parseAllowlist(undefined), { mode: "deny-all", emails: new Set() });
  assert.deepEqual(parseAllowlist(""), { mode: "deny-all", emails: new Set() });
});

test('parseAllowlist treats "*" as wildcard', () => {
  assert.deepEqual(parseAllowlist("*"), { mode: "allow-all", emails: new Set() });
  assert.deepEqual(parseAllowlist(" * "), { mode: "allow-all", emails: new Set() });
});

test("parseAllowlist splits on commas and lowercases", () => {
  const result = parseAllowlist("A@x.com, b@Y.com ,c@z.com");
  assert.equal(result.mode, "allow-listed");
  assert.deepEqual([...result.emails].sort(), ["a@x.com", "b@y.com", "c@z.com"]);
});

test("isEmailAllowed honors the three modes", () => {
  assert.equal(isEmailAllowed("any@x.com", { mode: "deny-all", emails: new Set() }), false);
  assert.equal(isEmailAllowed("any@x.com", { mode: "allow-all", emails: new Set() }), true);
  assert.equal(
    isEmailAllowed("A@X.com", { mode: "allow-listed", emails: new Set(["a@x.com"]) }),
    true,
  );
  assert.equal(
    isEmailAllowed("b@x.com", { mode: "allow-listed", emails: new Set(["a@x.com"]) }),
    false,
  );
});
