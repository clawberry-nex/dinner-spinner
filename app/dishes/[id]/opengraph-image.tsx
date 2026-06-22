import { sql } from "@/lib/db";
import { DishCard, FallbackCard } from "@/app/_og/card";
import { renderCardJpeg } from "@/lib/og/render";
import { fetchAsJpegDataUrl } from "@/lib/og/image";
import { dishOgText } from "@/lib/og/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Recipe on Dinner Spinner";
export const size = { width: 1200, height: 630 };
export const contentType = "image/jpeg";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dishId = Number(id);
  if (!Number.isFinite(dishId)) return renderCardJpeg(<FallbackCard />);

  const rows = await sql`
    SELECT title, subtitle, tags, base_servings, image_url
      FROM dishes
     WHERE id = ${dishId} AND public = true
     LIMIT 1
  `;
  if (rows.length === 0) return renderCardJpeg(<FallbackCard />);
  const row = rows[0];

  const { title, description } = dishOgText({
    title: row.title as string,
    subtitle: (row.subtitle as string | null) ?? null,
    tags: (row.tags as string[]) ?? [],
    baseServings: row.base_servings as number,
  });

  const photo = row.image_url ? await fetchAsJpegDataUrl(row.image_url as string) : null;
  return renderCardJpeg(<DishCard photo={photo} title={title} meta={description} />);
}
