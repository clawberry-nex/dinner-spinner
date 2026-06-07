"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icon";
import { BrandMark } from "./ui";

type NavDef = { href: string; icon: IconName; label: string; badge?: number };

type ProfileInfo = { name: string | null; handle: string | null; dishCount: number | null };

/**
 * Desktop sidebar (≥lg). Replaces the mobile bottom nav with a fixed 256px
 * left column: brand, the three core nav links, a prominent "Add a recipe"
 * button, and a profile footer. Nav items are real Next links with active
 * state derived from the pathname — no SPA tab state (cf. the prototype's
 * useKitchenStore, which we intentionally do NOT port).
 */
export function Sidebar({ planCount = 0 }: { planCount?: number }) {
  const pathname = usePathname() || "/";

  const nav: NavDef[] = [
    { href: "/", icon: "dome", label: "Decide" },
    { href: "/dishes", icon: "books", label: "Library" },
    { href: "/plan", icon: "basket", label: "Shopping", badge: planCount || undefined },
  ];

  // Map the current route to the active nav item, matching the mobile tab
  // grouping (settings/profile fall under "You", not a nav item here).
  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/dishes") return pathname.startsWith("/dishes");
    if (href === "/plan") return pathname.startsWith("/plan");
    return false;
  };
  const profileActive =
    pathname === "/me" || pathname.startsWith("/u/") || pathname.startsWith("/settings");

  return (
    <nav className="flex h-full w-64 flex-shrink-0 flex-col border-r border-line bg-gradient-to-b from-surface to-surface/55 px-4 pb-[18px] pt-[26px]">
      {/* Brand */}
      <Link href="/" className="mb-[30px] flex items-center gap-3 px-[10px] pt-[2px]">
        <BrandMark size={40} />
        <div className="min-w-0">
          <div
            className="truncate font-serif text-[21px] font-semibold leading-[1.04] tracking-[-0.01em] text-text"
          >
            Dinner Spinner
          </div>
          <div className="mt-1 text-[12.5px] tracking-[0.02em] text-text-faint">
            your kitchen
          </div>
        </div>
      </Link>

      {/* Nav */}
      <div className="flex flex-col gap-[3px]">
        {nav.map((item) => (
          <NavItem key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </div>

      {/* Add a recipe */}
      <Link
        href="/add"
        className="mt-4 flex items-center justify-center gap-[9px] rounded-md bg-accent px-3 py-3 text-[14px] font-bold text-accent-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition-colors hover:bg-accent-2 active:scale-[0.98]"
      >
        <Icon name="plus" size={18} stroke={2.3} />
        Add a recipe
      </Link>

      {/* Footer: profile */}
      <div className="mt-auto">
        <div className="mx-[6px] mb-[14px] h-px bg-line" />
        <ProfileFooter active={profileActive} />
      </div>
    </nav>
  );
}

function NavItem({ item, active }: { item: NavDef; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={[
        "relative flex w-full items-center gap-[13px] rounded-md px-[13px] py-[11px] text-left text-[14.5px] font-semibold transition-colors",
        active
          ? "bg-accent-tint text-accent-2"
          : "text-text-dim hover:bg-surface-2 hover:text-text",
      ].join(" ")}
    >
      {active && (
        <span
          aria-hidden
          className="absolute -left-4 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-[3px] bg-accent"
        />
      )}
      <Icon name={item.icon} size={21} stroke={active ? 1.9 : 1.65} />
      <span>{item.label}</span>
      {item.badge ? (
        <span className="tnum ml-auto grid h-5 min-w-5 place-items-center rounded-pill bg-accent px-[6px] text-[11px] font-bold text-accent-ink">
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

function ProfileFooter({ active }: { active: boolean }) {
  const [profile, setProfile] = useState<ProfileInfo | null>(null);

  // Best-effort, fetch-once-on-mount. Degrades to "Your kitchen" if either
  // request fails — the sidebar must never block on the network.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [profileRes, dishesRes] = await Promise.allSettled([
        fetch("/api/me/profile").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/dishes").then((r) => (r.ok ? r.json() : null)),
      ]);
      if (cancelled) return;
      const p =
        profileRes.status === "fulfilled" && profileRes.value
          ? (profileRes.value as { handle?: string; name?: string })
          : null;
      const dishes =
        dishesRes.status === "fulfilled" && Array.isArray(dishesRes.value)
          ? (dishesRes.value as unknown[])
          : null;
      if (!p && !dishes) return; // nothing usable — keep the fallback label
      setProfile({
        name: p?.name ?? null,
        handle: p?.handle ?? null,
        dishCount: dishes ? dishes.length : null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const name = profile?.name || "Your kitchen";
  const sub =
    profile?.handle != null
      ? `@${profile.handle}${profile.dishCount != null ? ` · ${profile.dishCount} ${profile.dishCount === 1 ? "dish" : "dishes"}` : ""}`
      : profile?.dishCount != null
        ? `${profile.dishCount} ${profile.dishCount === 1 ? "dish" : "dishes"}`
        : "Profile & settings";

  return (
    <Link
      href="/me"
      className={[
        "flex w-full items-center gap-[11px] rounded-md border px-[10px] py-[9px] text-left transition-colors",
        active
          ? "border-line bg-surface-2"
          : "border-transparent hover:border-line hover:bg-surface-2",
      ].join(" ")}
    >
      <div className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-2 to-accent-deep text-[16px]">
        <span aria-hidden>👩‍🍳</span>
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold text-text">{name}</div>
        <div className="truncate text-[11.5px] text-text-faint">{sub}</div>
      </div>
    </Link>
  );
}
