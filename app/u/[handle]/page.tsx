import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";
import { rowToDish, rowToProfile, type Dish } from "@/lib/types";
import ProfileView, { type KitchenStats } from "./profile-view";

// Profiles are reachable from the open web (per the public-profile
// design), but we don't want them indexed — the share-via-link model
// works fine without SEO. Per-page metadata wins over the layout default.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ProfilePage(
  props: PageProps<"/u/[handle]">,
) {
  const { handle: rawHandle } = await props.params;
  const handle = decodeURIComponent(rawHandle).toLowerCase();

  const userRows = await sql`
    SELECT id, handle, name, image, bio, handle_changed_at
      FROM users WHERE handle = ${handle} LIMIT 1
  `;
  if (userRows.length === 0) notFound();
  const profile = rowToProfile(userRows[0]);

  const session = await auth();
  const viewerId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const isOwner = viewerId === profile.id;
  const signedIn = viewerId !== null;

  // Owner sees everything; visitor sees only public. Owner rows also carry the
  // per-dish last-cooked timestamp used for ordering and the "last cooked" stat.
  const dishRows = isOwner
    ? await sql`
        SELECT d.*,
          (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at
        FROM dishes d
        WHERE d.user_id = ${profile.id}
        ORDER BY favorite DESC, last_cooked_at DESC NULLS LAST, id DESC
      `
    : await sql`
        SELECT d.*
        FROM dishes d
        WHERE d.user_id = ${profile.id} AND d.public = true
        ORDER BY favorite DESC, id DESC
      `;
  const dishes: Dish[] = dishRows.map(rowToDish);

  const stats = await computeStats(profile.id, dishes, isOwner);

  return (
    <ProfileView
      profile={profile}
      dishes={dishes}
      isOwner={isOwner}
      signedIn={signedIn}
      stats={stats}
    />
  );
}

// Kitchen stats. Dish/favorite/public counts come straight off the rows we
// already fetched. Cook-log aggregates (total cooks, avg rating, last cooked)
// are only meaningful — and only queried — for the owner; visitors get the
// public counts they can see and zeroed cook stats they never render.
async function computeStats(
  userId: string,
  dishes: Dish[],
  isOwner: boolean,
): Promise<KitchenStats> {
  const base: KitchenStats = {
    dishes: dishes.length,
    publicCount: dishes.filter((d) => d.public).length,
    favorites: dishes.filter((d) => d.favorite).length,
    cooks: 0,
    avgRating: null,
    lastCookedAt: null,
  };
  if (!isOwner) return base;

  const rows = await sql`
    SELECT
      COUNT(*)::int                                   AS cooks,
      AVG(rating)::float                              AS avg_rating,
      MAX(cooked_at)                                  AS last_cooked_at
    FROM cook_log
    WHERE user_id = ${userId}
  `;
  const row = rows[0] ?? {};
  return {
    ...base,
    cooks: typeof row.cooks === "number" ? row.cooks : 0,
    avgRating: row.avg_rating == null ? null : Number(row.avg_rating),
    lastCookedAt: row.last_cooked_at ? String(row.last_cooked_at) : null,
  };
}
