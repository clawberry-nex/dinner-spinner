import type { NextRequest } from "next/server";
import { resolveUserId } from "@/lib/auth-helpers";
import { advanceDishImageJob } from "@/lib/dish-image-job";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const job = await advanceDishImageJob(jobId, { dishId, userId });
  if (!job) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({
    status: job.status,
    imageUrl: job.imageUrl,
    error: job.error,
  });
}
