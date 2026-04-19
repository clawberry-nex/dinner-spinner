"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";

type Tab = { id: string; href: string; icon: IconName; label: string; badge?: number };

export function TabBar({ planCount = 0 }: { planCount?: number }) {
  const pathname = usePathname() || "/";
  const tabs: Tab[] = [
    { id: "spinner", href: "/",        icon: "dice", label: "Spin" },
    { id: "browse",  href: "/dishes",  icon: "list", label: "Dishes" },
    { id: "plan",    href: "/plan",    icon: "cart", label: "Plan", badge: planCount || undefined },
    { id: "admin",   href: "/admin",   icon: "chef", label: "Admin" },
  ];

  const activeId =
    pathname === "/" ? "spinner"
    : pathname.startsWith("/dishes") ? "browse"
    : pathname.startsWith("/plan") ? "plan"
    : pathname.startsWith("/admin") ? "admin"
    : "spinner";

  return (
    <nav className="relative z-10 flex border-t border-rule bg-paper px-1 pt-[6px] pb-2">
      {tabs.map((t) => {
        const on = activeId === t.id;
        return (
          <Link
            key={t.id}
            href={t.href}
            className={[
              "relative flex flex-1 flex-col items-center gap-[2px] px-1 py-[6px]",
              on ? "text-ink" : "text-ink-3",
            ].join(" ")}
          >
            <span className="relative">
              <Icon name={t.icon} size={22} />
              {t.badge ? (
                <span className="absolute -top-1 -right-2 grid h-4 min-w-4 place-items-center rounded-pill bg-accent px-1 text-[10px] font-semibold text-accent-ink">
                  {t.badge}
                </span>
              ) : null}
            </span>
            <span className={["text-[10px] tracking-[0.1em]", on ? "font-semibold" : "font-medium"].join(" ")}>
              {t.label.toUpperCase()}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
