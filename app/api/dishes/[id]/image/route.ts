import type { NextRequest } from "next/server";
import { after } from "next/server";
import { sql } from "@/lib/db";
import { rowToDish } from "@/lib/types";
import { resolveUserId } from "@/lib/auth-helpers";
import { startDishImageJob } from "@/lib/dish-image-job";
import { kickDishImageAdvance } from "@/lib/dish-image-background";

// Submission is quick; after() starts the browser-independent poll chain.
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]/image">,
) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const dishId = Number(id);
  if (!Number.isFinite(dishId)) {
    return Response.json({ error: "Bad id" }, { status: 400 });
  }
  const rows = await sql`
    SELECT * FROM dishes WHERE id = ${dishId} AND user_id = ${userId}
  `;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const dish = rowToDish(rows[0]);

  // Opportunistic prune — keep image_jobs small without a cron.
  await sql`DELETE FROM image_jobs WHERE created_at < now() - interval '1 day'`;

  const job = await startDishImageJob(dish, userId);
  if (job.status === "pending") {
    after(() => kickDishImageAdvance(job.id));
  }

  return Response.json({ jobId: job.id }, { status: 202 });
}
