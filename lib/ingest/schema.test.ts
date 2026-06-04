import { test } from "node:test";
import assert from "node:assert/strict";
import { DISH_INPUT_JSON_SCHEMA, stripNullFromAnyOf } from "./schema.ts";

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
  const itemProps = s.properties?.ingredients?.items?.properties ?? {};
  assert.ok("section" in itemProps, "ingredient items should expose a `section` property");
});

test("stripNullFromAnyOf collapses a [type, null] anyOf to the type", () => {
  const out = stripNullFromAnyOf({
    anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }],
  }) as Record<string, unknown> & { items?: Record<string, unknown> };
  assert.equal(out.type, "array");
  assert.equal(out.items?.type, "integer");
  assert.equal(out.anyOf, undefined);
});

test("stripNullFromAnyOf recurses into properties and items", () => {
  type PropNode = { type?: string; anyOf?: unknown; items?: { type?: string } };
  type OutShape = {
    properties: {
      a: PropNode;
      list: { type?: string; items?: { type?: string } };
    };
  };
  const out = stripNullFromAnyOf({
    type: "object",
    properties: {
      a: { anyOf: [{ type: "string" }, { type: "null" }] },
      list: { type: "array", items: { anyOf: [{ type: "number" }, { type: "null" }] } },
    },
  }) as OutShape;
  assert.equal(out.properties.a.type, "string");
  assert.equal(out.properties.a.anyOf, undefined);
  assert.equal(out.properties.list.items?.type, "number");
});

test("generated DISH_INPUT_JSON_SCHEMA has NO anyOf anywhere", () => {
  const json = JSON.stringify(DISH_INPUT_JSON_SCHEMA);
  assert.ok(!json.includes("\"anyOf\""), "schema should be anyOf-free for json-schema-to-zod compatibility");
});

test("methodRefs is now an enforceable array; ingredient section is a string", () => {
  type SchemaShape = {
    properties: {
      methodRefs: { type: string };
      ingredients: { items: { properties: { section: { type: string } } } };
    };
  };
  const s = DISH_INPUT_JSON_SCHEMA as unknown as SchemaShape;
  assert.equal(s.properties.methodRefs.type, "array");
  assert.equal(s.properties.ingredients.items.properties.section.type, "string");
});
