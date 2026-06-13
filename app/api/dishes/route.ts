import { z } from "zod";
import { sql } from "@/lib/db";
import { DishInputSchema, rowToDish } from "@/lib/types";
import { resolveUserId } from "@/lib/auth-helpers";
import { createDishForUser } from "@/lib/dish-create";

// Companion image options accepted alongside DishInput on create. Sent by the
// /add ingest flow for URL imports: `sourceImageUrl` is the recipe page's own
// photo (used instead of generating one); `generateImage` forces AI generation
// even when a source photo is present. Both default off, so the manual form
// and other callers are unaffected.
const ImageOptionsSchema = z.object({
  sourceImageUrl: z.string().url().nullable().optional(),
  generateImage: z.boolean().optional(),
});

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
            (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id) AS cook_count,
            (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
            (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
          FROM dishes d
          WHERE d.user_id = ${userId} AND tags @> ${tags}
          ORDER BY title ASC
        `
      : await sql`
          SELECT d.*,
            (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
            (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id) AS cook_count,
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
  const imgOpts = ImageOptionsSchema.safeParse(body);
  const dish = await createDishForUser(parsed.data, userId, {
    sourceImageUrl: imgOpts.success ? imgOpts.data.sourceImageUrl ?? null : null,
    generateImage: imgOpts.success ? imgOpts.data.generateImage ?? false : false,
  });
  return Response.json(dish, { status: 201 });
}
