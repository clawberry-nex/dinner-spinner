import { test } from "node:test";
import assert from "node:assert/strict";
import { DISH_INPUT_JSON_SCHEMA } from "./schema.ts";

test("schema is a flat object (no $ref wrapping)", () => {
  const s = DISH_INPUT_JSON_SCHEMA as Record<string, unknown>;
  assert.equal(s.type, "object");
  assert.ok(s.properties, "expected top-level `properties`");
  assert.equal(
    (s as { $ref?: unknown }).$ref,
    undefined,
    "schema should not wrap in $ref",
  );
});

test("schema marks title as required", () => {
  const s = DISH_INPUT_JSON_SCHEMA as { required?: string[] };
  assert.ok(s.required?.includes("title"), "title must be required");
});

test("schema declares an ingredients array of objects", () => {
  const s = DISH_INPUT_JSON_SCHEMA as {
    properties?: Record<string, { type?: string; items?: { type?: string } }>;
  };
  const ing = s.properties?.ingredients;
  assert.equal(ing?.type, "array");
  assert.equal(ing?.items?.type, "object");
});

test("schema declares an optional methodRefs property", () => {
  // methodRefs is .nullable().optional(), so Zod v4 may emit it as an `anyOf`
  // wrapper rather than a bare {type:"array"}. Assert the property exists.
  const s = DISH_INPUT_JSON_SCHEMA as { properties?: Record<string, unknown> };
  assert.ok(s.properties && "methodRefs" in s.properties, "methodRefs property exists");
});

test("ingredient items declare an optional section field", () => {
  const s = DISH_INPUT_JSON_SCHEMA as {
    properties?: {
      ingredients?: { items?: { properties?: Record<string, unknown> } };
    };
  };
  assert.ok(
    s.properties?.ingredients?.items?.properties?.section,
    "ingredient items should expose a `section` property",
  );
});
