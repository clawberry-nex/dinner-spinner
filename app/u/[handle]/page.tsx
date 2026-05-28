import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";
import { rowToDish, rowToProfile, type Dish } from "@/lib/types";
import { AppHeader } from "@/app/_components/app-header";
import { DishArt } from "@/app/_components/ui";
import { Icon } from "@/app/_components/icon";
import EditProfile from "./edit-profile";

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

  // Owner sees everything; visitor sees only public.
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
  const displayName = profile.name?.trim() || `@${profile.handle}`;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <AppHeader
        back
        right={
          isOwner ? (
            <Link
              href="/settings"
              aria-label="Settings"
              className="grid h-9 w-9 place-items-center rounded-pill border border-rule bg-paper text-ink-2"
            >
              <Icon name="gear" size={18} />
            </Link>
          ) : undefined
        }
      />
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-20">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          <ProfileHeader profile={profile} displayName={displayName} isOwner={isOwner} />

          <DishGrid dishes={dishes} isOwner={isOwner} />
        </div>
      </div>
    </div>
  );
}

function ProfileHeader({
  profile,
  displayName,
  isOwner,
}: {
  profile: ReturnType<typeof rowToProfile>;
  displayName: string;
  isOwner: boolean;
}) {
  return (
    <header className="mb-6 flex flex-col items-start gap-3">
      <div className="flex items-center gap-4">
        {profile.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.image}
            alt=""
            className="h-16 w-16 rounded-full border border-rule object-cover"
          />
        ) : (
          <div className="grid h-16 w-16 place-items-center rounded-full border border-rule bg-paper text-ink-3" aria-hidden="true">
            <Icon name="chef" size={28} />
          </div>
        )}
        <div className="flex-1">
          <h1
            className="m-0 text-[28px] font-medium leading-[1.05] tracking-[-0.02em] text-ink"
            style={{ fontFamily: "var(--font-disp)" }}
          >
            {displayName}
          </h1>
          <div className="mt-1 text-[13px] text-ink-3" style={{ fontFamily: "var(--font-mono)" }}>
            @{profile.handle}
          </div>
        </div>
      </div>
      {profile.bio && (
        <p className="text-[14px] leading-snug text-ink-2">{profile.bio}</p>
      )}
      {isOwner && (
        <EditProfile
          initial={{
            handle: profile.handle,
            bio: profile.bio,
            handleLocked: profile.handleLocked,
          }}
        />
      )}
    </header>
  );
}

function DishGrid({ dishes, isOwner }: { dishes: Dish[]; isOwner: boolean }) {
  if (dishes.length === 0) {
    return (
      <p className="mt-8 text-center text-[14px] text-ink-3">
        {isOwner ? "You haven't added any dishes yet." : "Nothing public here yet."}
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {dishes.map((d) => (
        <li key={d.id}>
          <Link
            href={`/dishes/${d.id}`}
            className="group block overflow-hidden rounded-lg border border-rule bg-paper"
          >
            <div className="relative">
              <DishArt dish={d} size="100%" corner="0" />
              {isOwner && !d.public && (
                <span
                  className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-pill bg-ink/80 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.1em] text-paper"
                  title="Private — only visible to you"
                >
                  private
                </span>
              )}
            </div>
            <div className="p-3">
              <div className="line-clamp-1 text-[14px] font-medium text-ink">{d.title}</div>
              {d.subtitle && (
                <div className="mt-1 line-clamp-1 text-[12px] italic text-ink-3">
                  {d.subtitle}
                </div>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
