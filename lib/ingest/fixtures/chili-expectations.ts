import type { DishInput } from "../../types.ts";
import { parseInlineRefs } from "../../inline-refs.ts";

// Source-grounded checks shared by the saved regression fixtures and live eval.
// This is an evaluation fixture, not a general-purpose recipe validator.
export function chiliFidelityErrors(dish: DishInput): string[] {
  const errors: string[] = [];
  const expected: [string, number, string][] = [
    ["onion", 2, "piece"], ["garlic", 3, "clove"], ["beef mince", 500, "g"],
    ["paprika", 2, "tsp"], ["cumin", 2, "tsp"], ["oregano", 2, "tsp"],
    ["onion powder", 1, "tsp"], ["cinnamon", 0.5, "tsp"],
    ["red pepper", 2, "piece"], ["black bean", 400, "g"],
    ["kidney bean", 400, "g"], ["tomato", 800, "g"],
    ["chipotle", 2, "tbsp"], ["water", 200, "ml"],
    ["chicken stock cube", 1, "piece"], ["dark chocolate", 50, "g"], ["sugar", 1, "tsp"],
  ];
  const find = (name: string) => dish.ingredients.find(i =>
    !i.optional && (name === "onion" || name === "garlic"
      ? i.name === name : i.name.includes(name)));
  for (const [name, quantity, unit] of expected) {
    const item = find(name);
    if (!item) errors.push(`missing required ingredient: ${name}`);
    else if (item.quantity !== quantity || item.unit !== unit) {
      errors.push(`${name}: expected ${quantity} ${unit}, got ${item.quantity} ${item.unit}`);
    }
  }
  if (dish.ingredients.some(i => i.name === "garlic powder")) errors.push("invented garlic powder");
  for (const [name, form] of [["black bean", "canned"], ["kidney bean", "canned"],
    ["cumin", "ground"], ["cinnamon", "ground"], ["dark chocolate", "70%"]]) {
    const item = find(name);
    if (!item || !`${item.name} ${item.descriptor}`.includes(form)) errors.push(`${name}: lost ${form}`);
  }
  if (find("chicken stock cube")?.scalable !== false) errors.push("stock cube must stay fixed");
  for (const name of ["sour cream", "cheddar", "jalapeño", "coriander", "lime", "tomato", "red onion"]) {
    if (!dish.ingredients.some(i => i.optional && i.name.includes(name))) errors.push(`missing optional topping: ${name}`);
  }
  const { text, refs } = parseInlineRefs(dish.recipe ?? "");
  for (const pattern of [/5[–-]6/, /3 min/, /2 min/, /90 min/, /1 cm/, /medium(?:[ -]high)? heat/, /cover|lid/, /## .*serv/i]) {
    if (!pattern.test(text)) errors.push(`method missing ${pattern}`);
  }
  if (text.trim().endsWith('"')) errors.push("stray trailing quote");
  if (!refs.length) errors.push("missing ingredient references");
  if (refs.some(ref => ref.ids.some(id => !/^\d+$/.test(id) || Number(id) >= dish.ingredients.length))) {
    errors.push("invalid ingredient reference index");
  }
  return errors;
}
