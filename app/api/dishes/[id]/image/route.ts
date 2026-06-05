import type { NextRequest } from "next/server";
import { after } from "next/server";
import { sql } from "@/lib/db";
import { rowToDish } from "@/lib/types";
import { resolveUserId } from "@/lib/auth-helpers";
import { generateAndStoreImage } from "@/lib/dish-image";

// after() runs the ~30-60s generation post-response; give it budget.
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

  const jobRows = await sql`
    INSERT INTO image_jobs (dish_id, user_id, status)
    VALUES (${dishId}, ${userId}, 'pending')
    RETURNING id
  `;
  const jobId = jobRows[0].id as string;

  after(async () => {
    try {
      const imageUrl = await generateAndStoreImage(dish, userId);
      await sql`
        UPDATE image_jobs SET status = 'done', image_url = ${imageUrl}, updated_at = now()
         WHERE id = ${jobId}
      `;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "image generation failed";
      await sql`
        UPDATE image_jobs SET status = 'failed', error = ${message}, updated_at = now()
         WHERE id = ${jobId}
      `.catch(() => {});
    }
  });

  return Response.json({ jobId }, { status: 202 });
}
