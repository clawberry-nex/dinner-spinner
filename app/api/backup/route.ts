import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";
import { rowToDish } from "@/lib/types";
import {
  buildBackup,
  parseBackup,
  type BackupMealPlanEntry,
} from "@/lib/backup";
import pkg from "../../../package.json" with { type: "json" };

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const dishRows = await sql`
    SELECT d.*,
      (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
      (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
      (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
    FROM dishes d
    WHERE d.user_id = ${userId}
    ORDER BY id ASC
  `;
  const pantryRows = await sql`
    SELECT name FROM pantry_names WHERE user_id = ${userId} ORDER BY name
  `;
  const mealRows = await sql`
    SELECT entries FROM meal_plan WHERE user_id = ${userId}
  `;

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

export async function POST(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
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

  // Dish import: insert with the importing user's user_id. If the backup
  // envelope's id collides with an existing row (possibly belonging to
  // ANOTHER user), the ON CONFLICT UPDATE is gated by user_id — the
  // update is skipped silently rather than allowing cross-user clobber.
  for (const d of envelope.dishes) {
    await sql`
      INSERT INTO dishes (
        id, user_id, title, subtitle, recipe, tags, ingredients, base_servings,
        favorite, image_url, emoji, accent, notes, image_description,
        created_at, updated_at
      )
      VALUES (
        ${d.id},
        ${userId},
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
      WHERE dishes.user_id = ${userId}
    `;
  }

  // Advance the dishes id sequence past any restored ids.
  await sql`
    SELECT setval(
      pg_get_serial_sequence('dishes', 'id'),
      GREATEST(
        (SELECT COALESCE(MAX(id), 0) FROM dishes),
        (SELECT last_value FROM dishes_id_seq)
      )
    )
  `;

  // Both ON CONFLICT clauses below require the post-lockdown PK shape
  // (pantry_names PK = (user_id, name); meal_plan PK = (user_id)).
  // db/lockdown.sql ships these. Pre-lockdown they'll error.
  for (const name of envelope.pantryNames) {
    const normalized = name.trim().toLowerCase();
    if (!normalized) continue;
    await sql`
      INSERT INTO pantry_names (user_id, name) VALUES (${userId}, ${normalized})
      ON CONFLICT (user_id, name) DO NOTHING
    `;
  }

  await sql`
    INSERT INTO meal_plan (user_id, entries)
    VALUES (${userId}, ${JSON.stringify(envelope.mealPlan.entries)}::jsonb)
    ON CONFLICT (user_id) DO UPDATE
      SET entries = EXCLUDED.entries,
          updated_at = now()
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
