import type { Ingredient } from "./types";

export function scaleIngredient(
  ingredient: Ingredient,
  servings: number,
  baseServings: number,
): Ingredient {
  const factor = servings / baseServings;
  return { ...ingredient, quantity: ingredient.quantity * factor };
}

export function formatQty(qty: number): string {
  if (!Number.isFinite(qty)) return String(qty);
  const rounded = Math.round(qty * 100) / 100;
  return rounded
    .toFixed(2)
    .replace(/\.?0+$/, "");
}

export function formatIngredient(ing: Ingredient): string {
  const qty = formatQty(ing.quantity);
  const unit = ing.unit?.trim();
  return unit ? `${qty} ${unit} ${ing.name}` : `${qty} ${ing.name}`;
}

type AggregateKey = string;

function keyOf(ing: Ingredient): AggregateKey {
  const name = ing.name.trim().toLowerCase();
  const unit = (ing.unit ?? "").trim().toLowerCase();
  return `${name}\u0000${unit}`;
}

export function aggregateIngredients(
  groups: { ingredients: Ingredient[]; servings: number; baseServings: number }[],
): Ingredient[] {
  const merged = new Map<AggregateKey, Ingredient>();
  for (const group of groups) {
    for (const raw of group.ingredients) {
      const scaled = scaleIngredient(raw, group.servings, group.baseServings);
      const key = keyOf(scaled);
      const existing = merged.get(key);
      if (existing) {
        existing.quantity += scaled.quantity;
      } else {
        merged.set(key, {
          quantity: scaled.quantity,
          unit: scaled.unit ?? null,
          name: scaled.name,
        });
      }
    }
  }
  return Array.from(merged.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
