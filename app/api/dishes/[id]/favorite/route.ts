import type { NextRequest } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { rowToDish } from "@/lib/types";
import { resolveUserId } from "@/lib/auth-helpers";

const BodySchema = z.object({
  favorite: z.boolean(),
});

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]/favorite">,
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

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const rows = await sql`
    UPDATE dishes SET favorite = ${parsed.data.favorite}, updated_at = now()
    WHERE id = ${Number(id)} AND user_id = ${userId}
    RETURNING *,
      (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = dishes.id) AS last_cooked_at,
      (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = dishes.id AND rating IS NOT NULL) AS avg_rating,
      (SELECT COUNT(*) FROM cook_log WHERE dish_id = dishes.id AND rating IS NOT NULL) AS rating_count
  `;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(rowToDish(rows[0]));
}
