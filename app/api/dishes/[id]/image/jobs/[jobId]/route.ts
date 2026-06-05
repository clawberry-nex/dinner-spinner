import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]/image/jobs/[jobId]">,
) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id, jobId } = await ctx.params;
  const dishId = Number(id);
  // Guard: a non-uuid jobId would make the uuid comparison throw in Postgres.
  if (!Number.isFinite(dishId) || !UUID_RE.test(jobId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await sql`
    SELECT status, image_url, error FROM image_jobs
     WHERE id = ${jobId} AND dish_id = ${dishId} AND user_id = ${userId}
  `;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const r = rows[0];
  return Response.json({
    status: r.status as string,
    imageUrl: (r.image_url as string | null) ?? null,
    error: (r.error as string | null) ?? null,
  });
}
