"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { TabBar } from "./tab-bar";

export function AppShell({ children, planCount, hideTabs, bottomSlot }: { children: ReactNode; planCount?: number; hideTabs?: boolean; bottomSlot?: ReactNode }) {
  const pathname = usePathname() || "/";
  // Hide all chrome (sidebar AND bottom nav) when the caller explicitly says so
  // (e.g. anon visitor on a shared link) OR on the immersive views that never
  // want chrome. Hiding at BOTH breakpoints keeps shared profile/dish links
  // rendering as standalone pages on desktop too.
  const hide = hideTabs || pathname.includes("/cook") || pathname.startsWith("/admin/login");
  const count = planCount ?? 0;

  return (
    // Outer frame: full viewport height, no body scroll. A flex ROW so the
    // desktop sidebar sits left of the content; below lg the sidebar is hidden
    // and the row degrades to a single content column.
    <div className="flex h-[100dvh] w-full overflow-hidden bg-bg">
      {/* Desktop sidebar (≥lg) — replaces the bottom nav. */}
      {!hide && (
        <div className="hidden lg:flex">
          <Sidebar planCount={count} />
        </div>
      )}

      {/* Content column. Stays a bounded-height flex column at every breakpoint
          so each routed page (root: `flex h-full min-h-0 flex-1 flex-col` with
          its own sticky header + inner `overflow-y-auto` body) keeps owning its
          scroll region. We deliberately don't wrap children in a scroller here
          — that would double-scroll and collapse the pages' `h-full`. Pages
          already center their content with `mx-auto max-w-*`, which reads as the
          desktop max-width once the sidebar narrows the main area. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
        {/* Mobile bottom nav (<lg). */}
        {!hide && <TabBar planCount={count} />}
        {/* Demo nav (replaces real chrome on /demo/*). */}
        {bottomSlot}
      </div>
    </div>
  );
}
