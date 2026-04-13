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

// Units that are implicit and shouldn't be rendered (data still stores them
// for aggregation correctness — "piece" is the canonical countable unit).
const HIDDEN_UNITS = new Set(["piece"]);

function visibleUnit(unit: string | null | undefined): string | null {
  const u = unit?.trim();
  if (!u) return null;
  if (HIDDEN_UNITS.has(u.toLowerCase())) return null;
  return u;
}

// Shopping-list format: qty, unit, descriptor, name — NO preparation.
// This is what Todoist tasks use; `preparation` is intentionally dropped.
export function formatIngredient(ing: Ingredient): string {
  const qty = formatQty(ing.quantity);
  const parts: string[] = [qty];
  const unit = visibleUnit(ing.unit);
  if (unit) parts.push(unit);
  if (ing.descriptor?.trim()) parts.push(ing.descriptor.trim());
  parts.push(ing.name);
  return parts.join(" ");
}

export { visibleUnit };

// Dish-detail format: shopping-list line + ", preparation" suffix if present.
export function formatIngredientDetailed(ing: Ingredient): string {
  const head = formatIngredient(ing);
  const prep = ing.preparation?.trim();
  return prep ? `${head}, ${prep}` : head;
}

type AggregateKey = string;

function keyOf(ing: Ingredient): AggregateKey {
  const name = ing.name.trim().toLowerCase();
  const unit = (ing.unit ?? "").trim().toLowerCase();
  const descriptor = (ing.descriptor ?? "").trim().toLowerCase();
  return `${name}\u0000${unit}\u0000${descriptor}`;
}

export function aggregateIngredients(
  groups: { ingredients: Ingredient[]; servings: number; baseServings: number }[],
): Ingredient[] {
  const merged = new Map<AggregateKey, Ingredient>();
  for (const group of groups) {
    for (const raw of group.ingredients) {
      // Pantry items are excluded from the shopping list — they're things
      // the user always has in stock (water, salt, pepper, etc.).
      if (raw.pantry) continue;
      const scaled = scaleIngredient(raw, group.servings, group.baseServings);
      const key = keyOf(scaled);
      const existing = merged.get(key);
      if (existing) {
        existing.quantity += scaled.quantity;
      } else {
        // preparation is intentionally omitted — the aggregation merges
        // across prep styles (sliced vs diced still collapses).
        merged.set(key, {
          quantity: scaled.quantity,
          unit: scaled.unit ?? null,
          name: scaled.name,
          descriptor: scaled.descriptor ?? null,
        });
      }
    }
  }
  return Array.from(merged.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
