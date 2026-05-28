import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";
import { rowToProfile } from "@/lib/types";
import { AppHeader } from "@/app/_components/app-header";
import { Icon } from "@/app/_components/icon";
import EditProfile from "../u/[handle]/edit-profile";

export const metadata = {
  title: "You — Dinner Spinner",
};

/**
 * /me is the owner-facing personal profile page (the destination of the
 * "You" tab). It's distinct from /u/[handle], which is the shareable
 * public view of the same person. Anon visitors get bounced to sign-in
 * with a callback back here.
 */
export default async function MePage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    redirect("/auth/signin?callbackUrl=%2Fme");
  }
  const rows = await sql`
    SELECT id, handle, name, image, bio, handle_changed_at
      FROM users WHERE id = ${userId} LIMIT 1
  `;
  if (!rows[0]) {
    // Shouldn't happen — session points to a user row that doesn't exist.
    redirect("/auth/signin?callbackUrl=%2Fme");
  }
  const profile = rowToProfile(rows[0]);
  const displayName = profile.name?.trim() || `@${profile.handle}`;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <AppHeader
        right={
          <Link
            href="/settings"
            aria-label="Settings"
            className="grid h-9 w-9 place-items-center rounded-pill border border-rule bg-paper text-ink-2"
          >
            <Icon name="gear" size={18} />
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-20">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          <header className="mb-8 flex flex-col items-start gap-3">
            <div className="flex items-center gap-4">
              {profile.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.image}
                  alt=""
                  className="h-16 w-16 rounded-full border border-rule object-cover"
                />
              ) : (
                <div
                  className="grid h-16 w-16 place-items-center rounded-full border border-rule bg-paper text-ink-3"
                  aria-hidden="true"
                >
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
                <Link
                  href={`/u/${profile.handle}`}
                  className="mt-1 inline-block text-[13px] text-ink-3 underline-offset-4 hover:underline"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  @{profile.handle}
                </Link>
              </div>
            </div>
            {profile.bio && (
              <p className="text-[14px] leading-snug text-ink-2">{profile.bio}</p>
            )}
            <EditProfile
              initial={{
                handle: profile.handle,
                bio: profile.bio,
                handleLocked: profile.handleLocked,
              }}
            />
            <p className="text-[12px] text-ink-3">
              Your public profile lives at{" "}
              <Link
                href={`/u/${profile.handle}`}
                className="underline underline-offset-4"
              >
                /u/{profile.handle}
              </Link>
              .
            </p>
          </header>

          <section>
            <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-ink-3">
              <Icon name="users" size={14} />
              <span>Friends</span>
            </div>
            <div className="rounded-lg border border-dashed border-rule p-6 text-center text-[13px] text-ink-3">
              Coming soon. Follow other cooks to see what they&rsquo;re making
              and pull their public recipes into your plan.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
