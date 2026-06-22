import { z } from "zod";

export const IngredientSchema = z.object({
  // Stable, dish-local id (see lib/inline-refs.ts::mintIngredientId). Inline
  // references in the Method text point at this, never at list position, so
  // reordering/inserting/deleting other ingredients never misaligns a tag.
  // Assigned server-side at create/edit; the ingest model never emits it.
  id: z.string().trim().min(1).max(16).optional(),
  quantity: z.number().nonnegative(),
  unit: z.string().trim().max(32).nullable().optional(),
  name: z.string().trim().min(1).max(128),
  descriptor: z.string().trim().max(60).nullable().optional(),
  preparation: z.string().trim().max(200).nullable().optional(),
  pantry: z.boolean().nullable().optional(),
  // scalable: false → scaleIngredient() is a no-op. Defaults to scalable.
  scalable: z.boolean().nullable().optional(),
  // optional: true → excluded from shopping list by default.
  optional: z.boolean().nullable().optional(),
  // Alternative ingredients the user can swap in (e.g. "butter" → ["olive oil"]).
  // Only the primary name goes on the shopping list.
  alternatives: z
    .array(z.string().trim().min(1).max(128))
    .max(8)
    .nullable()
    .optional(),
  // The recipe part this ingredient belongs to, mirroring a "## Section"
  // header in the method (e.g. "Dough", "Filling", "Toppings"). Display-only —
  // never affects shopping-list aggregation. Null/absent for single-part recipes.
  section: z.string().trim().max(40).nullable().optional(),
});

export type Ingredient = z.infer<typeof IngredientSchema>;

// Cook-mode ingredient highlighting is driven by inline `[label](#id)`
// references embedded directly in the Method text (see lib/inline-refs.ts and
// ADR-0001). There is no separate ref structure — the reference travels with
// the text, so `recipe` stays a plain string here.

export const DishInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(300).nullable().optional(),
  recipe: z.string().max(20_000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).default([]),
  ingredients: z.array(IngredientSchema).default([]),
  baseServings: z.number().int().positive().max(100).default(4),
  favorite: z.boolean().optional(),
  imageUrl: z.string().url().nullable().optional(),
  emoji: z.string().trim().max(16).nullable().optional(),
  accent: z.string().trim().max(60).nullable().optional(),
  // Persistent scratch-pad notes per dish (e.g. "Finn won't eat this
  // if there are mushrooms"). Distinct from cook_log.note, which is
  // a timestamped per-cook entry.
  notes: z.string().max(5_000).nullable().optional(),
  // AI-generated description of how the plated dish actually looks.
  // When non-null, used as the image-gen prompt input instead of the
  // user-facing subtitle. Hidden from the public dish view.
  imageDescription: z.string().max(2_000).nullable().optional(),
  // Visibility for the public profile page. Default true.
  public: z.boolean().optional(),
});

export type DishInput = z.infer<typeof DishInputSchema>;

// Partial body accepted by `PATCH /api/dishes/[id]`. Every field is
// optional; the route fetches the existing row and merges the
// provided fields on top of it. An explicit `null` is preserved (and
// clears nullable columns); a missing key leaves the column alone.
//
// Defined explicitly rather than via `DishInputSchema.partial()` because
// `.partial()` still substitutes the `.default([])` / `.default(4)` from
// the source schema for omitted `tags` / `ingredients` / `baseServings`,
// which would clobber the existing values on a partial patch.
export const DishPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  subtitle: z.string().trim().max(300).nullable().optional(),
  recipe: z.string().max(20_000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).optional(),
  ingredients: z.array(IngredientSchema).optional(),
  baseServings: z.number().int().positive().max(100).optional(),
  favorite: z.boolean().optional(),
  imageUrl: z.string().url().nullable().optional(),
  emoji: z.string().trim().max(16).nullable().optional(),
  accent: z.string().trim().max(60).nullable().optional(),
  notes: z.string().max(5_000).nullable().optional(),
  imageDescription: z.string().max(2_000).nullable().optional(),
  public: z.boolean().optional(),
});
export type DishPatchInput = z.infer<typeof DishPatchSchema>;

export type Dish = {
  id: number;
  title: string;
  subtitle: string | null;
  recipe: string | null;
  tags: string[];
  ingredients: Ingredient[];
  baseServings: number;
  favorite: boolean;
  imageUrl: string | null;
  emoji: string | null;
  accent: string | null;
  notes: string | null;
  imageDescription: string | null;
  public: boolean;
  lastCookedAt: string | null;
  averageRating: number | null;
  ratingCount: number;
  // Total cook-log entries (rated or not). Distinct from ratingCount (rated
  // only). Selected by queries that compute it; defaults to 0 otherwise.
  cookCount: number;
  createdAt: string;
  updatedAt: string;
};

// Public profile view of a user. Email is intentionally omitted from
// the visitor-facing payload.
export type Profile = {
  id: string;
  handle: string;
  name: string | null;
  image: string | null;
  bio: string | null;
  handleLocked: boolean;
};

export function rowToProfile(row: Record<string, unknown>): Profile {
  return {
    id: row.id as string,
    handle: row.handle as string,
    name: (row.name as string | null) ?? null,
    image: (row.image as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    handleLocked: row.handle_changed_at != null,
  };
}

export function rowToDish(row: Record<string, unknown>): Dish {
  const avg = row.avg_rating;
  const count = row.rating_count;
  return {
    id: row.id as number,
    title: row.title as string,
    subtitle: (row.subtitle as string | null) ?? null,
    recipe: (row.recipe as string | null) ?? null,
    tags: (row.tags as string[]) ?? [],
    ingredients: (row.ingredients as Ingredient[]) ?? [],
    baseServings: row.base_servings as number,
    favorite: (row.favorite as boolean | null) ?? false,
    imageUrl: (row.image_url as string | null) ?? null,
    emoji: (row.emoji as string | null) ?? null,
    accent: (row.accent as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    imageDescription: (row.image_description as string | null) ?? null,
    public: (row.public as boolean | null) ?? true,
    lastCookedAt: row.last_cooked_at ? String(row.last_cooked_at) : null,
    averageRating: avg == null ? null : Number(avg),
    ratingCount: count == null ? 0 : Number(count),
    cookCount: row.cook_count == null ? 0 : Number(row.cook_count),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export const CookLogEntrySchema = z.object({
  id: z.number().int(),
  cookedAt: z.string(),
  rating: z.number().int().min(1).max(5).nullable(),
  note: z.string().nullable(),
});

export type CookLogEntry = z.infer<typeof CookLogEntrySchema>;

export function rowToCookLogEntry(row: Record<string, unknown>): CookLogEntry {
  return {
    id: row.id as number,
    cookedAt: String(row.cooked_at),
    rating: (row.rating as number | null) ?? null,
    note: (row.note as string | null) ?? null,
  };
}
