import "server-only";
import { after } from "next/server";
import { sql } from "@/lib/db";
import { type Dish, type DishInput, rowToDish } from "@/lib/types";
import { applyPantryDefaults } from "@/lib/pantry";
import { sanitizeMethodRefs } from "@/lib/recipe";
import { generateAndStoreImage, storeImageFromUrl } from "@/lib/dish-image";

/**
 * The single source of truth for creating a dish from validated DishInput.
 * Both POST /api/dishes (single add / ingest) and the batch importer call
 * this so the create path can't drift between them.
 *
 * Steps (mirrors what POST /api/dishes did inline): apply the user's pantry
 * defaults, sanitize methodRefs against the POST-pantry ingredient count,
 * INSERT the row, return the Dish.
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

  const ingredients = await applyPantryDefaults(input.ingredients, userId);
  const d = {
    ...input,
    ingredients,
    methodRefs: sanitizeMethodRefs(input.methodRefs, ingredients.length),
  };

  const rows = await sql`
    INSERT INTO dishes (
      user_id, title, subtitle, recipe, tags, ingredients, base_servings,
      favorite, image_url, emoji, accent, notes, image_description, public, method_refs
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
      ${d.public ?? true},
      ${d.methodRefs == null ? null : JSON.stringify(d.methodRefs)}::jsonb
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
