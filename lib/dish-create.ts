import "server-only";
import { after } from "next/server";
import { sql } from "@/lib/db";
import { type Dish, type DishInput, rowToDish } from "@/lib/types";
import { applyPantryDefaults } from "@/lib/pantry";
import { assignIngredientIds, rewriteIndexRefsToIds } from "@/lib/inline-refs";
import { generateAndStoreImage, storeImageFromUrl } from "@/lib/dish-image";

/**
 * The single source of truth for creating a dish from validated DishInput.
 * Both POST /api/dishes (single add / ingest) and the batch importer call
 * this so the create path can't drift between them.
 *
 * Steps (mirrors what POST /api/dishes did inline): apply the user's pantry
 * defaults, assign stable ingredient ids, rewrite the method's inline index
 * references to those ids, INSERT the row, return the Dish.
 *
 * `autoImage` (default true): when the dish lands with no imageUrl, kick a
 * fire-and-forget image step via after(). Batch import passes `false` — it
 * generates images through one Gemini batch instead of N synchronous per-dish
 * calls. NOTE: after() only works inside a request/render context, so this
 * must be called from a route handler (it always is).
 *
 * Image source (URL imports): when `sourceImageUrl` is set and `generateImage`
 * is not forced, download+store that photo from the source page instead of
 * generating one. If the download fails, fall back to generation so the dish
 * still gets an image. `generateImage: true` forces AI generation even when a
 * source photo is available (the "generate instead" toggle on /add).
 */
export async function createDishForUser(
  input: DishInput,
  userId: string,
  opts: {
    autoImage?: boolean;
    sourceImageUrl?: string | null;
    generateImage?: boolean;
  } = {},
): Promise<Dish> {
  const { autoImage = true, sourceImageUrl = null, generateImage = false } = opts;

  // Stable ids first (existing ones preserved), then resolve the method's inline
  // references: the ingest model emits them by list INDEX (`#0`); now that every
  // ingredient has an id, rewrite each index to its id so the reference survives
  // later reordering. applyPantryDefaults only flags rows, so positions — and the
  // model's index references — stay aligned. Manual recipes carry no index tags,
  // so the rewrite is a no-op for them.
  const ingredients = assignIngredientIds(
    await applyPantryDefaults(input.ingredients, userId),
  );
  const recipe = input.recipe
    ? rewriteIndexRefsToIds(input.recipe, ingredients.map((i) => i.id!))
    : (input.recipe ?? null);
  const d = { ...input, ingredients, recipe };

  const rows = await sql`
    INSERT INTO dishes (
      user_id, title, subtitle, recipe, tags, ingredients, base_servings,
      favorite, image_url, emoji, accent, notes, image_description, public
    )
    VALUES (
      ${userId},
      ${d.title},
      ${d.subtitle ?? null},
      ${d.recipe ?? null},
      ${d.tags},
      ${JSON.stringify(d.ingredients)}::jsonb,
      ${d.baseServings},
      ${d.favorite ?? false},
      ${d.imageUrl ?? null},
      ${d.emoji ?? null},
      ${d.accent ?? null},
      ${d.notes ?? null},
      ${d.imageDescription ?? null},
      ${d.public ?? true}
    )
    RETURNING *
  `;
  const dish = rowToDish(rows[0]);

  if (autoImage && dish.imageUrl == null) {
    const useSource = !generateImage && !!sourceImageUrl;
    after(async () => {
      if (useSource) {
        try {
          await storeImageFromUrl(dish, userId, sourceImageUrl as string);
          return;
        } catch (err) {
          console.warn(
            `source image for dish ${dish.id} failed, generating instead:`,
            err,
          );
        }
      }
      try {
        await generateAndStoreImage(dish, userId);
      } catch (err) {
        console.warn(`auto image-gen failed for dish ${dish.id}:`, err);
      }
    });
  }

  return dish;
}
