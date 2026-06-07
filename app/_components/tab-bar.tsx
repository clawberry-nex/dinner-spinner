"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";

type Tab = { id: string; href: string; icon: IconName; label: string; badge?: number };

export function TabBar({ planCount = 0 }: { planCount?: number }) {
  const pathname = usePathname() || "/";

  const leftTabs: Tab[] = [
    { id: "spinner", href: "/", icon: "dome", label: "Decide" },
    { id: "browse", href: "/dishes", icon: "books", label: "Library" },
  ];
  const rightTabs: Tab[] = [
    { id: "plan", href: "/plan", icon: "basket", label: "Shop", badge: planCount || undefined },
    { id: "you", href: "/me", icon: "user2", label: "You" },
  ];

  // Route → active item, mirroring the desktop sidebar grouping (settings and
  // public-profile routes fall under "You").
  const activeId =
    pathname === "/" ? "spinner"
    : pathname.startsWith("/add") ? "add"
    : pathname.startsWith("/dishes") ? "browse"
    : pathname.startsWith("/plan") ? "plan"
    : pathname.startsWith("/u/") || pathname === "/me" || pathname.startsWith("/settings") ? "you"
    : "spinner";

  return (
    // Glass bottom nav, mobile only (sidebar replaces it at ≥lg).
    <nav
      className="sticky bottom-0 z-10 flex w-full flex-shrink-0 justify-center border-t border-line bg-surface/85 pt-1 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <div className="relative mx-auto flex w-full max-w-2xl items-stretch justify-around px-1">
        {leftTabs.map((t) => (
          <FlatTab key={t.id} tab={t} active={activeId === t.id} />
        ))}

        <div className="flex flex-1 justify-center">
          <Link
            href="/add"
            aria-label="Add recipe"
            className="flex flex-col items-center gap-[3px] pt-[2px]"
          >
            <span
              className={[
                "-mt-4 flex items-center justify-center rounded-full bg-accent text-accent-ink",
                "shadow-[0_0_0_4px_var(--bg),inset_0_1px_0_rgba(255,255,255,0.25)] transition-transform",
                activeId === "add" ? "scale-105" : "",
              ].join(" ")}
              style={{ width: 44, height: 44 }}
            >
              <Icon name="plus" size={22} stroke={2.4} />
            </span>
            <span className="text-[10px] font-semibold tracking-[0.02em] text-text-faint">Add</span>
          </Link>
        </div>

        {rightTabs.map((t) => (
          <FlatTab key={t.id} tab={t} active={activeId === t.id} />
        ))}
      </div>
    </nav>
  );
}

function FlatTab({ tab, active }: { tab: Tab; active: boolean }) {
  return (
    <Link
      href={tab.href}
      className={[
        "relative flex flex-1 flex-col items-center gap-1 px-1 pt-[6px] pb-[3px]",
        active ? "text-accent-2" : "text-text-faint",
      ].join(" ")}
    >
      <span className="relative flex h-[23px] items-center justify-center">
        <Icon name={tab.icon} size={22} stroke={active ? 1.95 : 1.6} />
        {tab.badge ? (
          <span className="absolute -top-[5px] -right-[10px] flex h-4 min-w-4 items-center justify-center rounded-pill border-2 border-surface bg-accent px-1 text-[10px] font-bold text-accent-ink">
            {tab.badge}
          </span>
        ) : null}
      </span>
      <span className={["text-[10px] tracking-[0.02em]", active ? "font-bold" : "font-semibold"].join(" ")}>
        {tab.label}
      </span>
      {/* active indicator dot */}
      <span
        aria-hidden
        className={["-mt-px h-1 w-1 rounded-full transition-colors", active ? "bg-accent" : "bg-transparent"].join(" ")}
      />
    </Link>
  );
}
