import { cookies } from "next/headers";
import { z } from "zod";
import { sql } from "@/lib/db";
import {
  ADMIN_COOKIE_NAME,
  checkApiToken,
  verifySessionCookieValue,
} from "@/lib/auth";
import { rowToCookLogEntry } from "@/lib/types";

async function isAuthorized(request: Request): Promise<boolean> {
  if (checkApiToken(request.headers.get("authorization"))) return true;
  const jar = await cookies();
  return verifySessionCookieValue(jar.get(ADMIN_COOKIE_NAME)?.value);
}

const BodySchema = z.object({
  dishId: z.number().int().positive(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const dishIdParam = url.searchParams.get("dishId");
  const dishId = dishIdParam ? Number(dishIdParam) : NaN;
  if (!Number.isFinite(dishId) || dishId <= 0) {
    return Response.json({ error: "dishId required" }, { status: 400 });
  }
  const rows = await sql`
    SELECT id, cooked_at, rating, note
    FROM cook_log
    WHERE dish_id = ${dishId}
    ORDER BY cooked_at DESC
    LIMIT 100
  `;
  return Response.json(rows.map(rowToCookLogEntry));
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

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { dishId, rating, note } = parsed.data;
  const trimmedNote = note?.trim() || null;
  const rows = await sql`
    INSERT INTO cook_log (dish_id, rating, note)
    VALUES (${dishId}, ${rating ?? null}, ${trimmedNote})
    RETURNING id, cooked_at, rating, note
  `;
  const entry = rowToCookLogEntry(rows[0]);
  return Response.json({ ok: true, ...entry });
}
