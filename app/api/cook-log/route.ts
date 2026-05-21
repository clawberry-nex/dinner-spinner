import { z } from "zod";
import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";
import { rowToCookLogEntry } from "@/lib/types";

const BodySchema = z.object({
  dishId: z.number().int().positive(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const dishIdParam = url.searchParams.get("dishId");
  const dishId = dishIdParam ? Number(dishIdParam) : NaN;
  if (!Number.isFinite(dishId) || dishId <= 0) {
    return Response.json({ error: "dishId required" }, { status: 400 });
  }
  const rows = await sql`
    SELECT id, cooked_at, rating, note
    FROM cook_log
    WHERE dish_id = ${dishId} AND user_id = ${userId}
    ORDER BY cooked_at DESC
    LIMIT 100
  `;
  return Response.json(rows.map(rowToCookLogEntry));
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

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { dishId, rating, note } = parsed.data;

  // Enforce dish ownership before logging.
  const owned = await sql`
    SELECT 1 FROM dishes WHERE id = ${dishId} AND user_id = ${userId} LIMIT 1
  `;
  if (owned.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const trimmedNote = note?.trim() || null;
  const rows = await sql`
    INSERT INTO cook_log (dish_id, user_id, rating, note)
    VALUES (${dishId}, ${userId}, ${rating ?? null}, ${trimmedNote})
    RETURNING id, cooked_at, rating, note
  `;
  const entry = rowToCookLogEntry(rows[0]);
  return Response.json({ ok: true, ...entry });
}
