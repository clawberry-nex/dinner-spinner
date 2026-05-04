import { cookies } from "next/headers";
import { after } from "next/server";
import { sql } from "@/lib/db";
import { DishInputSchema, rowToDish } from "@/lib/types";
import {
  ADMIN_COOKIE_NAME,
  checkApiToken,
  verifySessionCookieValue,
} from "@/lib/auth";
import { applyPantryDefaults } from "@/lib/pantry";
import { buildImagePrompt } from "@/lib/image-prompt";
import { getProvider } from "@/lib/image-provider";
import { uploadDishImage } from "@/lib/image-storage";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tagsParam = url.searchParams.get("tags");
  const tags = tagsParam
    ? tagsParam
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const rows =
    tags.length > 0
      ? await sql`
          SELECT d.*,
            (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
            (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
            (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
          FROM dishes d
          WHERE tags @> ${tags}
          ORDER BY title ASC
        `
      : await sql`
          SELECT d.*,
            (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
            (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
            (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
          FROM dishes d
          ORDER BY title ASC
        `;

  return Response.json(rows.map(rowToDish));
}

async function isAuthorized(request: Request): Promise<boolean> {
  if (checkApiToken(request.headers.get("authorization"))) return true;
  const jar = await cookies();
  return verifySessionCookieValue(jar.get(ADMIN_COOKIE_NAME)?.value);
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
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

  const d = {
    ...parsed.data,
    ingredients: await applyPantryDefaults(parsed.data.ingredients),
  };
  const rows = await sql`
    INSERT INTO dishes (
      title, subtitle, recipe, tags, ingredients, base_servings,
      favorite, image_url, emoji, accent, notes, image_description
    )
    VALUES (
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
      ${d.imageDescription ?? null}
    )
    RETURNING *
  `;
  const dish = rowToDish(rows[0]);

  // Auto-generate a hero photo for new dishes that didn't ship with one.
  // Runs AFTER the response is sent so the create call returns immediately
  // — Next's after() keeps the serverless function alive past the response
  // until the promise resolves. Failures are logged but don't propagate;
  // the admin can always click Generate manually.
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
             SET image_url = ${url},
                 updated_at = now()
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
