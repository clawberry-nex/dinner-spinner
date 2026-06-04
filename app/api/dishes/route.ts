import { after } from "next/server";
import { sql } from "@/lib/db";
import { DishInputSchema, rowToDish } from "@/lib/types";
import { resolveUserId } from "@/lib/auth-helpers";
import { applyPantryDefaults } from "@/lib/pantry";
import { sanitizeMethodRefs } from "@/lib/recipe";
import { buildImagePrompt } from "@/lib/image-prompt";
import { getProvider } from "@/lib/image-provider";
import { uploadDishImage } from "@/lib/image-storage";

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const tagsParam = url.searchParams.get("tags");
  const tags = tagsParam
    ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const rows =
    tags.length > 0
      ? await sql`
          SELECT d.*,
            (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
            (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
            (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
          FROM dishes d
          WHERE d.user_id = ${userId} AND tags @> ${tags}
          ORDER BY title ASC
        `
      : await sql`
          SELECT d.*,
            (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
            (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
            (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
          FROM dishes d
          WHERE d.user_id = ${userId}
          ORDER BY title ASC
        `;

  return Response.json(rows.map(rowToDish));
}

export async function POST(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = DishInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const ingredients = await applyPantryDefaults(parsed.data.ingredients, userId);
  const d = {
    ...parsed.data,
    ingredients,
    methodRefs: sanitizeMethodRefs(parsed.data.methodRefs, ingredients.length),
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

  if (dish.imageUrl == null) {
    after(async () => {
      try {
        const prompt = buildImagePrompt({
          title: dish.title,
          subtitle: dish.subtitle,
          imageDescription: dish.imageDescription,
        });
        const { bytes, mime } = await getProvider().generate(prompt);
        const url = await uploadDishImage(dish.id, bytes, mime);
        await sql`
          UPDATE dishes
             SET image_url = ${url}, updated_at = now()
           WHERE id = ${dish.id}
        `;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`auto image-gen failed for dish ${dish.id}:`, err);
      }
    });
  }

  return Response.json(dish, { status: 201 });
}
