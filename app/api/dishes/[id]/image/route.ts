import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { rowToDish } from "@/lib/types";
import {
  ADMIN_COOKIE_NAME,
  checkApiToken,
  verifySessionCookieValue,
} from "@/lib/auth";
import { buildImagePrompt } from "@/lib/image-prompt";
import { getProvider } from "@/lib/image-provider";
import { uploadDishImage } from "@/lib/image-storage";

async function isAuthorized(request: Request): Promise<boolean> {
  if (checkApiToken(request.headers.get("authorization"))) return true;
  const jar = await cookies();
  return verifySessionCookieValue(jar.get(ADMIN_COOKIE_NAME)?.value);
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]/image">,
) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const dishId = Number(id);
  if (!Number.isFinite(dishId)) {
    return Response.json({ error: "Bad id" }, { status: 400 });
  }
  const rows = await sql`SELECT * FROM dishes WHERE id = ${dishId}`;
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
     WHERE id = ${dishId}
    RETURNING id
  `;
  if (updated.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ imageUrl });
}
