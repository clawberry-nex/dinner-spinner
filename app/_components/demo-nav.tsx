"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";

type Tab = { href: string; icon: IconName; label: string; badge?: number };

export function DemoNav({ planCount = 0 }: { planCount?: number }) {
  const pathname = usePathname() || "/demo";
  const tabs: Tab[] = [
    { href: "/demo", icon: "dome", label: "Decide" },
    { href: "/demo/dishes", icon: "books", label: "Library" },
    { href: "/demo/plan", icon: "basket", label: "Shop", badge: planCount || undefined },
  ];
  const isActive = (href: string) =>
    href === "/demo" ? pathname === "/demo" : pathname.startsWith(href);

  return (
    <nav
      className="sticky bottom-0 z-10 flex w-full flex-shrink-0 flex-col border-t border-line bg-surface/90 backdrop-blur-xl"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-center justify-center gap-2 border-b border-line/60 px-4 py-[6px] text-[11px] text-text-faint">
        <span className="font-semibold uppercase tracking-[0.14em] text-accent">Demo</span>
        <span className="text-text-faint">· read-only</span>
        <span className="mx-1 text-line-2">|</span>
        <Link href="/auth/signup" className="font-semibold text-accent-2 hover:underline">
          Create your own →
        </Link>
      </div>
      <div className="mx-auto flex w-full max-w-2xl items-stretch justify-around px-1 pt-1">
        {tabs.map((t) => {
          const active = isActive(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={[
                "relative flex flex-1 flex-col items-center gap-1 px-1 pt-[6px] pb-[5px]",
                active ? "text-accent-2" : "text-text-faint",
              ].join(" ")}
            >
              <span className="relative flex h-[23px] items-center justify-center">
                <Icon name={t.icon} size={22} stroke={active ? 1.95 : 1.6} />
                {t.badge ? (
                  <span className="absolute -top-[5px] -right-[10px] flex h-4 min-w-4 items-center justify-center rounded-pill border-2 border-surface bg-accent px-1 text-[10px] font-bold text-accent-ink">
                    {t.badge}
                  </span>
                ) : null}
              </span>
              <span className={["text-[10px] tracking-[0.02em]", active ? "font-bold" : "font-semibold"].join(" ")}>
                {t.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
