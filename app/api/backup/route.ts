import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import {
  ADMIN_COOKIE_NAME,
  checkApiToken,
  verifySessionCookieValue,
} from "@/lib/auth";
import { rowToDish } from "@/lib/types";
import {
  buildBackup,
  parseBackup,
  type BackupMealPlanEntry,
} from "@/lib/backup";
import pkg from "../../../package.json" with { type: "json" };

async function isAuthorized(request: Request): Promise<boolean> {
  if (checkApiToken(request.headers.get("authorization"))) return true;
  const jar = await cookies();
  return verifySessionCookieValue(jar.get(ADMIN_COOKIE_NAME)?.value);
}

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dishRows = await sql`
    SELECT d.*,
      (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
      (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
      (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
    FROM dishes d
    ORDER BY id ASC
  `;
  const pantryRows = await sql`SELECT name FROM pantry_names ORDER BY name`;
  const mealRows = await sql`SELECT entries FROM meal_plan WHERE id = 1`;

  const envelope = buildBackup({
    dishes: dishRows.map(rowToDish),
    pantryNames: pantryRows.map((r) => r.name as string),
    mealPlan: {
      entries: (mealRows[0]?.entries as BackupMealPlanEntry[] | undefined) ?? [],
    },
    appVersion: (pkg as { version: string }).version,
  });

  const filename = `dinner-spinner-backup-${envelope.exportedAt.slice(0, 10)}.json`;
  return new Response(JSON.stringify(envelope, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
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

  let envelope;
  try {
    envelope = parseBackup(body);
  } catch (err) {
    const issues = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: "Invalid backup envelope", issues },
      { status: 400 },
    );
  }

  for (const d of envelope.dishes) {
    await sql`
      INSERT INTO dishes (
        id, title, subtitle, recipe, tags, ingredients, base_servings,
        favorite, image_url, emoji, accent, notes, image_description,
        created_at, updated_at
      )
      VALUES (
        ${d.id},
        ${d.title},
        ${d.subtitle},
        ${d.recipe},
        ${d.tags},
        ${JSON.stringify(d.ingredients)}::jsonb,
        ${d.baseServings},
        ${d.favorite},
        ${d.imageUrl},
        ${d.emoji},
        ${d.accent},
        ${d.notes ?? null},
        ${d.imageDescription ?? null},
        ${d.createdAt},
        ${d.updatedAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        subtitle = EXCLUDED.subtitle,
        recipe = EXCLUDED.recipe,
        tags = EXCLUDED.tags,
        ingredients = EXCLUDED.ingredients,
        base_servings = EXCLUDED.base_servings,
        favorite = EXCLUDED.favorite,
        image_url = EXCLUDED.image_url,
        emoji = EXCLUDED.emoji,
        accent = EXCLUDED.accent,
        notes = EXCLUDED.notes,
        image_description = EXCLUDED.image_description,
        updated_at = EXCLUDED.updated_at
    `;
  }

  // Advance the dishes id sequence to the higher of current MAX(id) and
  // the sequence's own last_value, so future INSERTs don't collide with
  // any restored id.
  await sql`
    SELECT setval(
      pg_get_serial_sequence('dishes', 'id'),
      GREATEST(
        (SELECT COALESCE(MAX(id), 0) FROM dishes),
        (SELECT last_value FROM dishes_id_seq)
      )
    )
  `;

  for (const name of envelope.pantryNames) {
    const normalized = name.trim().toLowerCase();
    if (!normalized) continue;
    await sql`
      INSERT INTO pantry_names (name) VALUES (${normalized})
      ON CONFLICT (name) DO NOTHING
    `;
  }

  await sql`
    UPDATE meal_plan
    SET entries = ${JSON.stringify(envelope.mealPlan.entries)}::jsonb,
        updated_at = now()
    WHERE id = 1
  `;

  return Response.json({
    ok: true,
    counts: {
      dishes: envelope.dishes.length,
      pantryNames: envelope.pantryNames.length,
      mealPlanEntries: envelope.mealPlan.entries.length,
    },
  });
}
