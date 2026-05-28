"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";

type Tab = { id: string; href: string; icon: IconName; label: string; badge?: number };

export function TabBar({ planCount = 0 }: { planCount?: number }) {
  const pathname = usePathname() || "/";

  const leftTabs: Tab[] = [
    { id: "spinner", href: "/",        icon: "dice", label: "Spin" },
    { id: "browse",  href: "/dishes",  icon: "list", label: "Dishes" },
  ];
  const rightTabs: Tab[] = [
    { id: "plan", href: "/plan", icon: "cart", label: "Plan", badge: planCount || undefined },
    { id: "you",  href: "/me",   icon: "user", label: "You" },
  ];

  const activeId =
    pathname === "/" ? "spinner"
    : pathname.startsWith("/add") ? "add"
    : pathname.startsWith("/dishes") ? "browse"
    : pathname.startsWith("/plan") ? "plan"
    : pathname.startsWith("/u/") || pathname === "/me" || pathname.startsWith("/settings") ? "you"
    : "spinner";

  return (
    <nav
      className="sticky bottom-0 z-10 flex w-full flex-shrink-0 justify-center border-t border-rule bg-paper pt-[6px]"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <div className="relative mx-auto flex w-full max-w-2xl items-end px-1">
        {leftTabs.map((t) => (
          <FlatTab key={t.id} tab={t} active={activeId === t.id} />
        ))}

        <div className="flex flex-1 justify-center">
          <Link
            href="/add"
            aria-label="Add recipe"
            className={[
              "-mt-5 flex items-center justify-center rounded-full bg-accent text-accent-ink shadow-md transition-transform",
              activeId === "add" ? "scale-105" : "",
            ].join(" ")}
            style={{ width: 52, height: 52 }}
          >
            <Icon name="plus" size={26} />
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
        "relative flex flex-1 flex-col items-center gap-[2px] px-1 py-[6px]",
        active ? "text-ink" : "text-ink-3",
      ].join(" ")}
    >
      <span className="relative">
        <Icon name={tab.icon} size={22} />
        {tab.badge ? (
          <span className="absolute -top-1 -right-2 grid h-4 min-w-4 place-items-center rounded-pill bg-accent px-1 text-[10px] font-semibold text-accent-ink">
            {tab.badge}
          </span>
        ) : null}
      </span>
      <span
        className={[
          "text-[10px] tracking-[0.1em]",
          active ? "font-semibold" : "font-medium",
        ].join(" ")}
      >
        {tab.label.toUpperCase()}
      </span>
    </Link>
  );
}
