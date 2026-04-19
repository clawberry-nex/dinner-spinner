"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { TabBar } from "./tab-bar";

export function AppShell({ children, planCount, hideTabs }: { children: ReactNode; planCount?: number; hideTabs?: boolean }) {
  const pathname = usePathname() || "/";
  const hide = hideTabs ?? (pathname.includes("/cook") || pathname.startsWith("/admin/login"));
  return (
    <div className="mx-auto flex h-[100dvh] max-w-[440px] flex-col overflow-hidden bg-bg md:max-w-2xl lg:max-w-3xl">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      {!hide && <TabBar planCount={planCount ?? 0} />}
    </div>
  );
}
