import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DishInputSchema } from "../types.ts";
import { normalizeEscapedWhitespace } from "./sanitize.ts";
import { chiliFidelityErrors } from "./fixtures/chili-expectations.ts";

function fixture(name: string) {
  const raw = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
  normalizeEscapedWhitespace(raw);
  return DishInputSchema.parse(raw);
}

test("the original Haiku output fails source-grounded fidelity checks despite valid JSON", () => {
  const errors = chiliFidelityErrors(fixture("chili-haiku-result"));
  for (const name of ["paprika", "cumin", "oregano", "cinnamon", "sugar"]) {
    assert.ok(errors.some(error => error.startsWith(`${name}: expected`)));
  }
  assert.ok(errors.includes("missing required ingredient: onion powder"));
  assert.ok(errors.includes("invented garlic powder"));
  assert.ok(errors.includes("black bean: lost canned"));
  assert.ok(errors.includes("missing optional topping: sour cream"));
});

test("the reviewed live Sol output preserves source quantities, products, method, and toppings", () => {
  assert.deepEqual(chiliFidelityErrors(fixture("chili-sol-result")), []);
});

test("fidelity checks reject quantity or unit drift for every measured source ingredient", () => {
  const good = fixture("chili-sol-result");
  const measured = good.ingredients.filter(i => i.unit && !i.optional && i.unit !== "to taste");
  assert.equal(measured.length, 17);
  for (const ingredient of measured) {
    for (const field of ["quantity", "unit"] as const) {
      const changed = structuredClone(good);
      const row = changed.ingredients.find(i => i.name === ingredient.name)!;
      if (field === "quantity") row.quantity *= 3;
      else row.unit = row.unit === "tsp" ? "tbsp" : "tsp";
      assert.ok(chiliFidelityErrors(changed).length > 0, `${ingredient.name}: ${field}`);
    }
  }
});
