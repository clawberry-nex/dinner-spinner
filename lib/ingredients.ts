import type { Ingredient } from "./types";
import {
  fromCanonical,
  getCategory,
  toCanonical,
  type UnitCategory,
} from "./units";

// applyPantryDefaults lives in lib/pantry.ts (server-only, DB-backed).
// This file stays pure so client components can import from it.

export function scaleIngredient(
  ingredient: Ingredient,
  servings: number,
  baseServings: number,
): Ingredient {
  // Explicit scalable:false → quantity is fixed regardless of servings
  // (e.g. 1 bay leaf, 1 cinnamon stick).
  if (ingredient.scalable === false) return ingredient;
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

// The aggregation key groups ingredients by (name, unit-category, descriptor).
// For weight and volume, the category is a whole bucket (so g/kg/oz/lb merge;
// ml/l/tsp/tbsp/cup/fl oz merge). For count/imprecise units, the category is
// the literal unit string (so 2 handful + 1 handful = 3 handful, but
// 1 can + 100 ml stays separate because we don't know a can's volume).
function keyOf(ing: Ingredient): AggregateKey {
  const name = ing.name.trim().toLowerCase();
  const descriptor = (ing.descriptor ?? "").trim().toLowerCase();
  const category = getCategory(ing.unit);
  const unitKey =
    category === "other" ? (ing.unit ?? "").trim().toLowerCase() : category;
  return `${name}\u0000${unitKey}\u0000${descriptor}`;
}

type IngredientGroup = {
  ingredients: Ingredient[];
  servings: number;
  baseServings: number;
};

type Bucket = {
  canonicalQty: number;
  category: UnitCategory;
  originalUnit: string | null;
  seed: Ingredient;
};

function aggregate(
  groups: IngredientGroup[],
  predicate: (ing: Ingredient) => boolean,
): Ingredient[] {
  const merged = new Map<AggregateKey, Bucket>();
  for (const group of groups) {
    for (const raw of group.ingredients) {
      if (!predicate(raw)) continue;
      const scaled = scaleIngredient(raw, group.servings, group.baseServings);
      const key = keyOf(scaled);
      const category = getCategory(scaled.unit);
      const canonicalQty = toCanonical(scaled.quantity, scaled.unit);
      const existing = merged.get(key);
      if (existing) {
        existing.canonicalQty += canonicalQty;
      } else {
        merged.set(key, {
          canonicalQty,
          category,
          originalUnit: scaled.unit ?? null,
          seed: scaled,
        });
      }
    }
  }

  return Array.from(merged.values())
    .map(({ canonicalQty, category, originalUnit, seed }): Ingredient => {
      // For weight/volume, convert back to a display-friendly unit.
      // For "other" categories, keep the literal unit that came in.
      const { quantity, unit } =
        category === "other"
          ? { quantity: canonicalQty, unit: originalUnit }
          : fromCanonical(canonicalQty, category);
      return {
        quantity,
        unit,
        name: seed.name,
        descriptor: seed.descriptor ?? null,
        pantry: seed.pantry ?? null,
        // preparation is intentionally dropped during aggregation
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

type AggregateOptions = {
  includeOptional?: boolean;
};

// Shopping list: everything the user needs to actually buy.
// Pantry items are excluded (they're things like water/salt/pepper
// the user always has in stock). Optional items are excluded by default;
// pass { includeOptional: true } to include them.
export function aggregateIngredients(
  groups: IngredientGroup[],
  options: AggregateOptions = {},
): Ingredient[] {
  const includeOptional = options.includeOptional ?? false;
  return aggregate(
    groups,
    (ing) => !ing.pantry && (includeOptional || !ing.optional),
  );
}

// Pantry items used in the plan — reference view so the user can
// sanity-check their stock. Never sent to Todoist.
export function aggregatePantryItems(
  groups: IngredientGroup[],
  options: AggregateOptions = {},
): Ingredient[] {
  const includeOptional = options.includeOptional ?? false;
  return aggregate(
    groups,
    (ing) => !!ing.pantry && (includeOptional || !ing.optional),
  );
}
