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

const PlanEntrySchema = z.object({
  id: z.number().int().positive(),
  servings: z.number().int().positive().max(100),
  // 0 = Monday .. 6 = Sunday. Missing/null = unassigned (pool column).
  day: z.number().int().min(0).max(6).nullable().optional(),
});

const BodySchema = z.object({
  entries: z.array(PlanEntrySchema),
});

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await sql`SELECT entries, updated_at FROM meal_plan WHERE id = 1`;
  if (rows.length === 0) {
    return Response.json({ entries: [], updatedAt: null });
  }
  return Response.json({
    entries: rows[0].entries,
    updatedAt: String(rows[0].updated_at),
  });
}

export async function PUT(request: Request) {
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
    UPDATE meal_plan SET
      entries = ${JSON.stringify(parsed.data.entries)}::jsonb,
      updated_at = now()
    WHERE id = 1
    RETURNING entries, updated_at
  `;
  return Response.json({
    entries: rows[0].entries,
    updatedAt: String(rows[0].updated_at),
  });
}
