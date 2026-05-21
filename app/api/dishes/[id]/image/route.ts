import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { rowToDish } from "@/lib/types";
import { resolveUserId } from "@/lib/auth-helpers";
import { buildImagePrompt } from "@/lib/image-prompt";
import { getProvider } from "@/lib/image-provider";
import { uploadDishImage } from "@/lib/image-storage";

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

  let imageUrl: string;
  try {
    const prompt = buildImagePrompt({
      title: dish.title,
      subtitle: dish.subtitle,
      imageDescription: dish.imageDescription,
    });
    const { bytes, mime } = await getProvider().generate(prompt);
    imageUrl = await uploadDishImage(dishId, bytes, mime);
  } catch (err) {
    const message = err instanceof Error ? err.message : "image generation failed";
    return Response.json({ error: message }, { status: 502 });
  }

  const updated = await sql`
    UPDATE dishes
       SET image_url = ${imageUrl},
           updated_at = now()
     WHERE id = ${dishId} AND user_id = ${userId}
    RETURNING id
  `;
  if (updated.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ imageUrl });
}
