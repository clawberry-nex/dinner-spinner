import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { DishPatchSchema, rowToDish } from "@/lib/types";
import {
  ADMIN_COOKIE_NAME,
  checkApiToken,
  verifySessionCookieValue,
} from "@/lib/auth";
import { applyPantryDefaults } from "@/lib/pantry";

async function isAuthorized(request: Request): Promise<boolean> {
  if (checkApiToken(request.headers.get("authorization"))) return true;
  const jar = await cookies();
  return verifySessionCookieValue(jar.get(ADMIN_COOKIE_NAME)?.value);
}

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]">,
) {
  const { id } = await ctx.params;
  const rows = await sql`
    SELECT d.*,
      (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
      (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
      (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
    FROM dishes d
    WHERE id = ${Number(id)}
  `;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(rowToDish(rows[0]));
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]">,
) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = DishPatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const u = parsed.data;
  if (Object.keys(u).length === 0) {
    return Response.json({ error: "No fields to update" }, { status: 400 });
  }

  const existingRows = await sql`
    SELECT d.*,
      (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
      (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
      (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
    FROM dishes d
    WHERE d.id = ${Number(id)}
  `;
  if (existingRows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const existing = rowToDish(existingRows[0]);

  const ingredients =
    u.ingredients !== undefined
      ? await applyPantryDefaults(u.ingredients)
      : existing.ingredients;

  const merged = {
    title: u.title ?? existing.title,
    subtitle: u.subtitle === undefined ? existing.subtitle : u.subtitle,
    recipe: u.recipe === undefined ? existing.recipe : u.recipe,
    tags: u.tags ?? existing.tags,
    baseServings: u.baseServings ?? existing.baseServings,
    favorite: u.favorite === undefined ? existing.favorite : u.favorite,
    imageUrl: u.imageUrl === undefined ? existing.imageUrl : u.imageUrl,
    emoji: u.emoji === undefined ? existing.emoji : u.emoji,
    accent: u.accent === undefined ? existing.accent : u.accent,
    notes: u.notes === undefined ? existing.notes : u.notes,
  };

  const rows = await sql`
    UPDATE dishes SET
      title = ${merged.title},
      subtitle = ${merged.subtitle ?? null},
      recipe = ${merged.recipe ?? null},
      tags = ${merged.tags},
      ingredients = ${JSON.stringify(ingredients)}::jsonb,
      base_servings = ${merged.baseServings},
      favorite = ${merged.favorite ?? false},
      image_url = ${merged.imageUrl ?? null},
      emoji = ${merged.emoji ?? null},
      accent = ${merged.accent ?? null},
      notes = ${merged.notes ?? null},
      updated_at = now()
    WHERE id = ${Number(id)}
    RETURNING *
  `;
  return Response.json(rowToDish(rows[0]));
}

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]">,
) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const rows = await sql`DELETE FROM dishes WHERE id = ${Number(id)} RETURNING id`;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
