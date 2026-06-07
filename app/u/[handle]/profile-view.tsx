"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Icon, type IconName } from "@/app/_components/icon";
import { BrandMark, DishArt, useToast } from "@/app/_components/ui";
import { useTheme } from "@/app/_components/theme-provider";
import { computeDietFlags } from "@/lib/diet";
import type { Dish, Profile } from "@/lib/types";
import EditProfile from "./edit-profile";

// Kitchen stats derived from the owner's dish collection. Mirrors the
// prototype's `kitchenStats` (desktop-profile.jsx): totals across dishes
// plus the cook-log aggregates the server already computed.
export type KitchenStats = {
  dishes: number;
  publicCount: number;
  favorites: number;
  cooks: number;
  avgRating: number | null;
  lastCookedAt: string | null;
};

type Props = {
  profile: Profile;
  dishes: Dish[];
  isOwner: boolean;
  signedIn: boolean;
  stats: KitchenStats;
};

function shortDiet(d: Dish): string | null {
  const flags = computeDietFlags(d.ingredients);
  if (flags.vegan) return "VEGAN";
  if (flags.vegetarian) return "VEG";
  return null;
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${Math.floor(days)}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * V2 public-kitchen / profile view. One client component drives both the
 * owner experience (full controls, kitchen stats, every dish with a lock
 * badge on private ones) and the visitor experience (identity + public
 * dishes + a standalone Dinner Spinner credit). The server (`page.tsx`)
 * owns the data fetch and the owner/visitor gating; this only styles what
 * it's handed and never re-derives WHO sees WHAT.
 */
export default function ProfileView({ profile, dishes, isOwner, signedIn, stats }: Props) {
  const { show, el } = useToast();
  const displayName = profile.name?.trim() || `@${profile.handle}`;

  // Public URL the owner shares. Built client-side from the current origin so
  // it's correct on prod and any preview/host without hardcoding a domain.
  const publicPath = `/u/${profile.handle}`;
  const copyLink = () => {
    const url =
      typeof window !== "undefined" ? `${window.location.origin}${publicPath}` : publicPath;
    void navigator.clipboard?.writeText(url).then(
      () => show("Link copied to clipboard"),
      () => show("Couldn’t copy link"),
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-24 lg:pb-12">
        <div className="mx-auto w-full max-w-5xl px-5 pt-[var(--safe-top)] lg:px-10">
          {isOwner ? (
            <OwnerHeader
              profile={profile}
              displayName={displayName}
              publicPath={publicPath}
              stats={stats}
              onCopy={copyLink}
            />
          ) : (
            <VisitorHeader profile={profile} displayName={displayName} stats={stats} />
          )}

          <DishGrid dishes={dishes} isOwner={isOwner} />

          {isOwner ? <OwnerFooter /> : <VisitorFooter />}
        </div>
      </div>
      {/* Anon visitors keep their own theme toggle reachable without the shell.
          The owner gets it inline in the header; signed-out visitors get a
          subtle floating control so the share-link page still respects taste. */}
      {!signedIn && <FloatingThemeToggle />}
      {el}
    </div>
  );
}

// ---------------------------------------------------------------
// Owner header — identity + actions + kitchen stats.
// ---------------------------------------------------------------
function OwnerHeader({
  profile,
  displayName,
  publicPath,
  stats,
  onCopy,
}: {
  profile: Profile;
  displayName: string;
  publicPath: string;
  stats: KitchenStats;
  onCopy: () => void;
}) {
  const [editing, setEditing] = useState(false);
  // Render the canonical host on the server + first client paint so hydration
  // matches, then upgrade to the real host after mount.
  const [host, setHost] = useState("dinner-spinner.app");
  useEffect(() => setHost(window.location.host), []);

  return (
    <header>
      <div className="mb-[10px] flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
          Your kitchen
        </div>
        <div className="flex items-center gap-[7px]">
          <ThemeToggle />
          <Link
            href="/settings"
            aria-label="Settings"
            className="grid h-9 w-9 place-items-center rounded-pill border border-line bg-surface-2 text-text-dim transition-colors hover:text-text"
          >
            <Icon name="gear" size={18} />
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-7">
        <Avatar image={profile.image} size={96} className="lg:h-[104px] lg:w-[104px]" />
        <div className="min-w-0 flex-1">
          <h1
            className="m-0 font-semibold leading-[1.02] tracking-[-0.02em] text-text"
            style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(28px,5vw,38px)" }}
          >
            {displayName}
          </h1>
          <div className="mt-[5px] text-[14px] font-semibold text-accent-2" style={{ fontFamily: "var(--font-mono)" }}>
            @{profile.handle}
          </div>
          {profile.bio && (
            <p className="mt-[13px] max-w-xl text-[14.5px] leading-[1.5] text-text-dim lg:text-[15px]">
              {profile.bio}
            </p>
          )}

          <div className="mt-[18px] flex flex-wrap items-center gap-[10px]">
            <Link
              href={publicPath}
              className="inline-flex items-center gap-2 rounded-pill bg-accent px-[18px] py-[10px] text-[13.5px] font-semibold text-accent-ink transition-colors hover:bg-accent-2"
              style={{ letterSpacing: 0.2 }}
            >
              <Icon name="link" size={16} style={{ color: "var(--accent-ink)" }} />
              View public page
            </Link>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 rounded-pill border border-line bg-transparent px-[16px] py-[10px] text-[13.5px] font-semibold text-text transition-colors hover:border-line-2"
              style={{ letterSpacing: 0.2 }}
            >
              <Icon name="edit" size={16} />
              Edit profile
            </button>
          </div>

          {/* copyable share pill */}
          <button
            type="button"
            onClick={onCopy}
            title="Copy link"
            className="mt-[11px] flex w-full max-w-md items-center gap-2 rounded-[var(--radius-md)] bg-surface-2 px-[14px] py-[10px] text-left text-[12.5px] text-text-dim transition-colors hover:bg-surface-3"
          >
            <Icon name="link" size={14} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
            <span className="truncate" style={{ fontFamily: "var(--font-sans)" }}>
              {host}/u/<span className="font-semibold text-accent-2">{profile.handle}</span>
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-[5px] text-[12px] font-semibold text-text-faint">
              <Icon name="cards" size={13} style={{ color: "var(--text-faint)" }} />
              Copy
            </span>
          </button>
        </div>
      </div>

      <KitchenStats stats={stats} />

      {editing && (
        <EditProfile
          mode="modal"
          initial={{ handle: profile.handle, bio: profile.bio, handleLocked: profile.handleLocked }}
          onClose={() => setEditing(false)}
        />
      )}
    </header>
  );
}

// ---------------------------------------------------------------
// Visitor header — identity + a compact public stat line. No controls.
// ---------------------------------------------------------------
function VisitorHeader({
  profile,
  displayName,
  stats,
}: {
  profile: Profile;
  displayName: string;
  stats: KitchenStats;
}) {
  return (
    <header className="pt-2 text-center lg:pt-8">
      <Avatar image={profile.image} size={84} className="mx-auto lg:h-[104px] lg:w-[104px]" />
      <h1
        className="mx-auto mt-4 font-semibold leading-[1.04] tracking-[-0.02em] text-text"
        style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(27px,5vw,42px)" }}
      >
        {displayName}
      </h1>
      <div className="mt-[5px] text-[14px] font-semibold text-accent-2" style={{ fontFamily: "var(--font-mono)" }}>
        @{profile.handle}
      </div>
      {profile.bio && (
        <p className="mx-auto mt-[13px] max-w-md text-[14.5px] leading-[1.55] text-text-dim lg:text-[16px]">
          {profile.bio}
        </p>
      )}
      <div className="mt-[20px] flex items-center justify-center gap-7">
        <div>
          <span className="tnum font-semibold text-text" style={{ fontFamily: "var(--font-serif)", fontSize: 22 }}>
            {stats.dishes}
          </span>
          <span className="ml-[7px] text-[13px] text-text-faint">
            {stats.dishes === 1 ? "recipe" : "recipes"}
          </span>
        </div>
        <div className="h-6 w-px bg-line-2" aria-hidden />
        <div>
          <span className="tnum font-semibold text-text" style={{ fontFamily: "var(--font-serif)", fontSize: 22 }}>
            {stats.favorites}
          </span>
          <span className="ml-[7px] text-[13px] text-text-faint">favorites</span>
        </div>
      </div>
      <div className="mx-auto mt-7 h-px max-w-3xl bg-line" />
    </header>
  );
}

// ---------------------------------------------------------------
// Kitchen stats (owner) — four tiles derived from the collection.
// Hidden on the narrowest phones in a 2-col grid; full row on desktop.
// ---------------------------------------------------------------
function KitchenStats({ stats }: { stats: KitchenStats }) {
  const tiles: { icon: IconName; value: string; label: string; sub: string }[] = [
    {
      icon: "books",
      value: String(stats.dishes),
      label: "Dishes",
      sub: `${stats.publicCount} public · ${Math.max(0, stats.dishes - stats.publicCount)} private`,
    },
    {
      icon: "flame",
      value: String(stats.cooks),
      label: "Cooks logged",
      sub: stats.lastCookedAt ? `last ${relTime(stats.lastCookedAt)}` : "across the collection",
    },
    {
      icon: "heart",
      value: String(stats.favorites),
      label: "Favorites",
      sub: "hand-picked",
    },
    {
      icon: "star",
      value: stats.avgRating != null ? `${stats.avgRating.toFixed(1)}★` : "—",
      label: "Avg rating",
      sub: stats.avgRating != null ? "from your cook log" : "no ratings yet",
    },
  ];
  return (
    <div className="mt-[26px] grid grid-cols-2 gap-[12px] lg:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-[var(--radius-lg)] border border-line bg-surface px-[18px] py-[16px] shadow-[var(--shadow-card)]"
        >
          <div className="flex items-center gap-2 text-text-faint">
            <Icon name={t.icon} size={15} style={{ color: "var(--accent-2)" }} />
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">{t.label}</span>
          </div>
          <div
            className="tnum mt-[10px] font-semibold leading-none text-text"
            style={{ fontFamily: "var(--font-serif)", fontSize: 30 }}
          >
            {t.value}
          </div>
          <div className="mt-[5px] text-[12px] text-text-faint">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------
// Dish grid — V2 art tiles. Owner sees ALL their dishes (lock badge on
// private); visitor sees only what the server handed (public only).
// ---------------------------------------------------------------
function DishGrid({ dishes, isOwner }: { dishes: Dish[]; isOwner: boolean }) {
  if (dishes.length === 0) {
    return isOwner ? (
      <div className="mt-10 rounded-[var(--radius-lg)] border border-dashed border-line px-6 py-14 text-center">
        <div className="text-[46px] opacity-40">🍳</div>
        <h2 className="mt-3 text-[20px] font-semibold text-text" style={{ fontFamily: "var(--font-serif)" }}>
          No dishes yet
        </h2>
        <p className="mx-auto mt-[6px] max-w-xs text-[13.5px] text-text-dim">
          Add your first recipe and it’ll show up here — and on your shareable public page.
        </p>
        <Link
          href="/add"
          className="mt-5 inline-flex items-center gap-2 rounded-pill bg-accent px-[18px] py-[10px] text-[13.5px] font-semibold text-accent-ink transition-colors hover:bg-accent-2"
        >
          <Icon name="plus" size={16} style={{ color: "var(--accent-ink)" }} />
          Add a recipe
        </Link>
      </div>
    ) : (
      <p className="mt-10 text-center text-[14px] text-text-dim">Nothing public here yet.</p>
    );
  }

  return (
    <section className="mt-[34px]">
      <div className="mb-[16px] flex items-baseline justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
          {isOwner ? `Your dishes · ${dishes.length}` : `Recipes · ${dishes.length}`}
        </div>
        {isOwner && (
          <span className="text-[12.5px] text-text-faint">
            {dishes.filter((d) => d.public).length} shown on your public page
          </span>
        )}
      </div>
      <ul className="grid grid-cols-2 gap-[12px] sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(208px,1fr))] lg:gap-[18px]">
        {dishes.map((d) => (
          <li key={d.id}>
            <Link
              href={`/dishes/${d.id}`}
              className="group block overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-card)] transition-[transform,border-color] duration-200 ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-[3px] hover:border-line-2"
            >
              <div className="relative w-full overflow-hidden" style={{ aspectRatio: "1.18" }}>
                <DishArt dish={d} fill emojiSize={52} />
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{ background: "linear-gradient(180deg, transparent 54%, rgba(15,11,8,0.78) 100%)" }}
                />
                {/* favourite marker — owner-relevant; harmless on public favourites too */}
                {d.favorite && (
                  <div
                    className="absolute right-[9px] top-[9px] grid h-8 w-8 place-items-center rounded-pill"
                    style={{ background: "rgba(20,14,11,0.5)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
                  >
                    <Icon name="heart" size={14} fill style={{ color: "var(--rose)" }} />
                  </div>
                )}
                {isOwner && !d.public && (
                  <span
                    className="absolute left-[9px] top-[9px] inline-flex items-center rounded-pill px-[8px] py-[3px] text-[9.5px] font-bold uppercase tracking-[0.1em] text-text-dim"
                    style={{ background: "rgba(20,14,11,0.62)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
                    title="Private — only visible to you"
                  >
                    Private
                  </span>
                )}
                {/* title sits over the scrim for a richer card */}
                <h3
                  className="absolute inset-x-0 bottom-0 line-clamp-2 px-[12px] pb-[11px] text-[15px] font-semibold leading-[1.14] text-white"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  {d.title}
                </h3>
              </div>
              {(d.subtitle || shortDiet(d)) && (
                <div className="px-[13px] pb-[13px] pt-[10px]">
                  {d.subtitle && (
                    <div className="line-clamp-1 text-[12px] italic text-text-dim">{d.subtitle}</div>
                  )}
                  {shortDiet(d) && (
                    <div className="mt-[6px] text-[10px] font-bold tracking-[0.04em] text-sage">{shortDiet(d)}</div>
                  )}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------
// Owner footer — "signed in as" + sign out.
// ---------------------------------------------------------------
function OwnerFooter() {
  return (
    <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
      <div className="flex items-center gap-[11px] text-[13.5px] text-text-dim">
        <Icon name="user2" size={17} style={{ color: "var(--text-faint)" }} />
        Manage your account in{" "}
        <Link href="/settings" className="text-accent-2 underline-offset-4 hover:underline">
          settings
        </Link>
      </div>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/auth/signin" })}
        className="inline-flex items-center gap-2 rounded-pill border border-accent-line bg-transparent px-[16px] py-[9px] text-[13px] font-semibold text-accent-2 transition-colors hover:bg-accent-tint"
      >
        Sign out
      </button>
    </div>
  );
}

// ---------------------------------------------------------------
// Visitor footer — standalone Dinner Spinner credit (no chrome).
// ---------------------------------------------------------------
function VisitorFooter() {
  return (
    <div className="mx-auto mt-12 max-w-3xl text-center">
      <div className="mb-6 h-px bg-line" />
      <div className="inline-flex items-center gap-[9px]">
        <BrandMark size={44} />
        <span className="font-semibold text-text" style={{ fontFamily: "var(--font-serif)", fontSize: 22 }}>
          Dinner Spinner
        </span>
      </div>
      <p className="mx-auto mt-[14px] max-w-sm text-[13px] leading-[1.55] text-text-faint">
        A public kitchen on Dinner Spinner. Anyone with the link can browse — no account needed.
      </p>
      <Link
        href="/"
        className="mt-[18px] inline-flex items-center gap-2 rounded-pill border border-line bg-transparent px-[18px] py-[10px] text-[13.5px] font-semibold text-text transition-colors hover:border-line-2"
      >
        Start your own
        <Icon name="arrowR" size={16} />
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------
// Avatar — user image, or the emoji-on-accent-gradient placeholder.
// ---------------------------------------------------------------
function Avatar({ image, size, className }: { image: string | null; size: number; className?: string }) {
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt=""
        width={size}
        height={size}
        className={["shrink-0 rounded-full border border-line object-cover", className ?? ""].join(" ")}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={["grid shrink-0 place-items-center rounded-full shadow-[var(--shadow-card)]", className ?? ""].join(" ")}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.46,
        background: "linear-gradient(135deg, var(--accent-2), var(--accent-deep))",
      }}
    >
      👩‍🍳
    </div>
  );
}

// ---------------------------------------------------------------
// Theme toggle — compact system/light/dark segmented control. Backed by
// the app's ThemeProvider so it persists and matches /settings.
// ---------------------------------------------------------------
const THEME_OPTS: { id: "system" | "light" | "dark"; icon: IconName; label: string }[] = [
  { id: "system", icon: "theme-auto", label: "System theme" },
  { id: "light", icon: "sun", label: "Light theme" },
  { id: "dark", icon: "moon", label: "Dark theme" },
];

function ThemeToggle() {
  const { setting, set } = useTheme();
  return (
    <div className="inline-flex gap-[3px] rounded-pill border border-line bg-surface p-[3px]">
      {THEME_OPTS.map((o) => {
        const on = setting === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => set(o.id)}
            aria-label={o.label}
            aria-pressed={on}
            className={[
              "grid h-[30px] w-[30px] place-items-center rounded-pill transition-colors",
              on ? "bg-surface-3 text-text" : "bg-transparent text-text-faint hover:text-text-dim",
            ].join(" ")}
          >
            <Icon name={o.icon} size={16} />
          </button>
        );
      })}
    </div>
  );
}

// Floating theme toggle for anon visitors (no shell to host it). Sits at the
// top-right so the shared page still respects the reader's light/dark taste.
function FloatingThemeToggle() {
  return (
    <div className="pointer-events-auto fixed right-3 top-3 z-40 lg:right-5 lg:top-5">
      <ThemeToggle />
    </div>
  );
}
