import { z } from "zod";
import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";

const PlanEntrySchema = z.object({
  id: z.number().int().positive(),
  servings: z.number().int().positive().max(100),
  // 0 = Monday .. 6 = Sunday. Missing/null = unassigned (pool column).
  day: z.number().int().min(0).max(6).nullable().optional(),
});

const BodySchema = z.object({
  entries: z.array(PlanEntrySchema),
});

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rows = await sql`
    SELECT entries, updated_at FROM meal_plan WHERE user_id = ${userId}
  `;
  if (rows.length === 0) {
    return Response.json({ entries: [], updatedAt: null });
  }
  return Response.json({
    entries: rows[0].entries,
    updatedAt: String(rows[0].updated_at),
  });
}

export async function PUT(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Requires the (user_id) PK from db/lockdown.sql. Pre-lockdown, the
  // legacy single-row meal_plan still has id=1 with no user_id; the
  // backfill assigns it to the seed owner, then lockdown drops `id` and
  // sets user_id as the PK. After that, this upsert works for every user.
  const rows = await sql`
    INSERT INTO meal_plan (user_id, entries)
    VALUES (${userId}, ${JSON.stringify(parsed.data.entries)}::jsonb)
    ON CONFLICT (user_id) DO UPDATE
      SET entries = EXCLUDED.entries,
          updated_at = now()
    RETURNING entries, updated_at
  `;
  return Response.json({
    entries: rows[0].entries,
    updatedAt: String(rows[0].updated_at),
  });
}
