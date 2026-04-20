import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { sql } from "@/lib/db";
import { rowToDish } from "@/lib/types";
import {
  ADMIN_COOKIE_NAME,
  checkApiToken,
  verifySessionCookieValue,
} from "@/lib/auth";

async function isAuthorized(request: Request): Promise<boolean> {
  if (checkApiToken(request.headers.get("authorization"))) return true;
  const jar = await cookies();
  return verifySessionCookieValue(jar.get(ADMIN_COOKIE_NAME)?.value);
}

const BodySchema = z.object({
  favorite: z.boolean(),
});

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]/favorite">,
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

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const rows = await sql`
    UPDATE dishes SET favorite = ${parsed.data.favorite}, updated_at = now()
    WHERE id = ${Number(id)}
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
