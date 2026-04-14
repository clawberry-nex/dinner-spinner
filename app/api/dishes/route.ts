import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { DishInputSchema, rowToDish } from "@/lib/types";
import {
  ADMIN_COOKIE_NAME,
  checkApiToken,
  verifySessionCookieValue,
} from "@/lib/auth";
import { applyPantryDefaults } from "@/lib/pantry";

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
          SELECT d.*, (
            SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id
          ) AS last_cooked_at
          FROM dishes d
          WHERE tags @> ${tags}
          ORDER BY title ASC
        `
      : await sql`
          SELECT d.*, (
            SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id
          ) AS last_cooked_at
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
      favorite, image_url
    )
    VALUES (
      ${d.title},
      ${d.subtitle ?? null},
      ${d.recipe ?? null},
      ${d.tags},
      ${JSON.stringify(d.ingredients)}::jsonb,
      ${d.baseServings},
      ${d.favorite ?? false},
      ${d.imageUrl ?? null}
    )
    RETURNING *
  `;
  return Response.json(rowToDish(rows[0]), { status: 201 });
}
