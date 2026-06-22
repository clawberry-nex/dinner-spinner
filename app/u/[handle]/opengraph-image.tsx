import { sql } from "@/lib/db";
import { ProfileCard, FallbackCard } from "@/app/_og/card";
import { renderCardJpeg } from "@/lib/og/render";
import { fetchAsJpegDataUrl } from "@/lib/og/image";
import { profileOgText } from "@/lib/og/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Recipes on Dinner Spinner";
export const size = { width: 1200, height: 630 };
export const contentType = "image/jpeg";

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = await params;
  const handle = decodeURIComponent(raw).toLowerCase();

  const users = await sql`SELECT id, handle, name, image, bio FROM users WHERE handle = ${handle} LIMIT 1`;
  if (users.length === 0) return renderCardJpeg(<FallbackCard />);
  const u = users[0];

  const countRows = await sql`SELECT COUNT(*)::int AS n FROM dishes WHERE user_id = ${u.id} AND public = true`;
  const publicCount = (countRows[0]?.n as number) ?? 0;

  const { description } = profileOgText(
    { name: (u.name as string | null) ?? null, handle: u.handle as string, bio: (u.bio as string | null) ?? null },
    publicCount,
  );

  // Representative photo: the avatar, else a favourite/recent public dish photo.
  let photoUrl = (u.image as string | null) ?? null;
  if (!photoUrl) {
    const dishPhoto = await sql`
      SELECT image_url FROM dishes
       WHERE user_id = ${u.id} AND public = true AND image_url IS NOT NULL
       ORDER BY favorite DESC, id DESC LIMIT 1
    `;
    photoUrl = (dishPhoto[0]?.image_url as string | null) ?? null;
  }
  const photo = photoUrl ? await fetchAsJpegDataUrl(photoUrl) : null;

  const nameTrimmed = (u.name as string | null)?.trim();
  const displayName = nameTrimmed || `@${u.handle as string}`;
  return renderCardJpeg(
    <ProfileCard photo={photo} name={displayName} handle={nameTrimmed ? (u.handle as string) : null} line={description} />,
  );
}
