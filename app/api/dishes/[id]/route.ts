import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { DishPatchSchema, rowToDish } from "@/lib/types";
import { resolveUserId } from "@/lib/auth-helpers";
import { applyPantryDefaults } from "@/lib/pantry";
import { sanitizeMethodRefs } from "@/lib/recipe";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]">,
) {
  // Public dishes are readable anonymously; private dishes are owner-only.
  // We DON'T 401 missing auth here — that would defeat the public-share
  // case. resolveUserId returns null for anon and that's fine.
  const userId = await resolveUserId(req);

  const { id } = await ctx.params;
  const rows = await sql`
    SELECT d.*,
      (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
      (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
      (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
    FROM dishes d
    WHERE d.id = ${Number(id)} AND (d.public = true OR d.user_id = ${userId})
  `;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(rowToDish(rows[0]));
}

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]">,
) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
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
    WHERE d.id = ${Number(id)} AND d.user_id = ${userId}
  `;
  if (existingRows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const existing = rowToDish(existingRows[0]);

  const ingredients =
    u.ingredients !== undefined
      ? await applyPantryDefaults(u.ingredients, userId)
      : existing.ingredients;

  // methodRefs indices are positional (into the ingredients array). On omit,
  // re-sanitize the existing refs against the (possibly changed) ingredient
  // count so any now-out-of-range index is dropped; an explicit null clears;
  // an array replaces. (A raw-API reorder that keeps the same count but omits
  // methodRefs can leave refs pointing at the wrong row — a recoverable cook-
  // mode highlight mismatch, not data corruption; the in-app form clears refs
  // on any ingredient edit.)
  const methodRefs =
    u.methodRefs === undefined
      ? sanitizeMethodRefs(existing.methodRefs, ingredients.length)
      : u.methodRefs === null
        ? null
        : sanitizeMethodRefs(u.methodRefs, ingredients.length);

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
    imageDescription:
      u.imageDescription === undefined
        ? existing.imageDescription
        : u.imageDescription,
    public: u.public === undefined ? existing.public : u.public,
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
      image_description = ${merged.imageDescription ?? null},
      public = ${merged.public},
      method_refs = ${methodRefs == null ? null : JSON.stringify(methodRefs)}::jsonb,
      updated_at = now()
    WHERE id = ${Number(id)} AND user_id = ${userId}
    RETURNING *
  `;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(rowToDish(rows[0]));
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]">,
) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const rows = await sql`
    DELETE FROM dishes
    WHERE id = ${Number(id)} AND user_id = ${userId}
    RETURNING id
  `;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
