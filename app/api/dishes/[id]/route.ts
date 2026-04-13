import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { DishInputSchema, rowToDish } from "@/lib/types";
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

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]">,
) {
  const { id } = await ctx.params;
  const rows = await sql`SELECT * FROM dishes WHERE id = ${Number(id)}`;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(rowToDish(rows[0]));
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]">,
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

  const parsed = DishInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const rows = await sql`
    UPDATE dishes SET
      title = ${d.title},
      subtitle = ${d.subtitle ?? null},
      recipe = ${d.recipe ?? null},
      tags = ${d.tags},
      ingredients = ${JSON.stringify(d.ingredients)}::jsonb,
      base_servings = ${d.baseServings},
      updated_at = now()
    WHERE id = ${Number(id)}
    RETURNING *
  `;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(rowToDish(rows[0]));
}

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]">,
) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const rows = await sql`DELETE FROM dishes WHERE id = ${Number(id)} RETURNING id`;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
