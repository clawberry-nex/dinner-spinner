import { cookies } from "next/headers";
import { z } from "zod";
import { sql } from "@/lib/db";
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
  dishId: z.number().int().positive(),
});

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

  const rows = await sql`
    INSERT INTO cook_log (dish_id)
    VALUES (${parsed.data.dishId})
    RETURNING id, cooked_at
  `;
  return Response.json({
    ok: true,
    id: rows[0].id,
    cookedAt: String(rows[0].cooked_at),
  });
}
