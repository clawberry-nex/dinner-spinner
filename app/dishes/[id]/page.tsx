import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";
import { rowToCookLogEntry, rowToDish } from "@/lib/types";
import { dishOgText } from "@/lib/og/meta";
import DishView from "./dish-view";

export async function generateMetadata(
  props: PageProps<"/dishes/[id]">,
): Promise<Metadata> {
  const base: Metadata = { robots: { index: false, follow: false } };
  const { id } = await props.params;
  const dishId = Number(id);
  if (!Number.isFinite(dishId)) return base;

  const rows = await sql`
    SELECT title, subtitle, tags, base_servings
      FROM dishes WHERE id = ${dishId} AND public = true LIMIT 1
  `;
  if (rows.length === 0) return base;
  const row = rows[0];

  const { title, description } = dishOgText({
    title: row.title as string,
    subtitle: (row.subtitle as string | null) ?? null,
    tags: (row.tags as string[]) ?? [],
    baseServings: row.base_servings as number,
  });
  return {
    ...base,
    title,
    description,
    openGraph: { type: "article", title, description, url: `/dishes/${dishId}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function DishPage(props: PageProps<"/dishes/[id]">) {
  const { id } = await props.params;
  const dishId = Number(id);
  if (!Number.isFinite(dishId)) notFound();

  const session = await auth();
  const viewerId = (session?.user as { id?: string } | undefined)?.id ?? null;

  // Public dishes are readable by anyone (incl. anon); private dishes
  // are still owner-only. Cross-user reads on private dishes 404 to avoid
  // leaking existence.
  const rows = await sql`
    SELECT d.*,
      (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
      (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
      (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count,
      u.handle AS owner_handle,
      u.name   AS owner_name
    FROM dishes d
    JOIN users u ON u.id = d.user_id
    WHERE d.id = ${dishId} AND (d.public = true OR d.user_id = ${viewerId})
  `;
  if (rows.length === 0) notFound();
  const dish = rowToDish(rows[0]);
  const ownerId = rows[0].user_id as string;
  const isOwner = viewerId !== null && viewerId === ownerId;
  const ownerHandle = (rows[0].owner_handle as string) ?? null;
  const ownerName = (rows[0].owner_name as string | null) ?? null;

  // Only the owner's cook history loads — visitors don't see ratings/notes,
  // and we don't need the rows.
  const history = isOwner
    ? (
        await sql`
          SELECT id, cooked_at, rating, note
          FROM cook_log
          WHERE dish_id = ${dishId} AND user_id = ${viewerId}
          ORDER BY cooked_at DESC
          LIMIT 100
        `
      ).map(rowToCookLogEntry)
    : [];

  return (
    <DishView
      dish={dish}
      history={history}
      isOwner={isOwner}
      ownerHandle={ownerHandle}
      ownerName={ownerName}
    />
  );
}
