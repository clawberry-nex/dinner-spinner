"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { AppShell } from "./app-shell";
import { ImportProvider } from "./import-provider";
import { DemoNav } from "./demo-nav";
import { readPlan } from "@/lib/plan-storage";

export function RootShell({
  children,
  isSignedIn,
}: {
  children: ReactNode;
  isSignedIn: boolean;
}) {
  const [planCount, setPlanCount] = useState(0);
  const pathname = usePathname();
  const isDemo = (pathname || "").startsWith("/demo");

  useEffect(() => {
    const key = isDemo ? "demoMealPlan" : "mealPlan";
    const read = () => setPlanCount(readPlan(key).length);
    read();
    const onStorage = (e: StorageEvent) => { if (e.key === key) read(); };
    window.addEventListener("storage", onStorage);
    const t = window.setInterval(read, 1500);
    return () => { window.removeEventListener("storage", onStorage); window.clearInterval(t); };
  }, [pathname, isDemo]);

  return (
    <AppShell
      planCount={planCount}
      hideTabs={!isSignedIn || isDemo}
      bottomSlot={isDemo ? <DemoNav planCount={planCount} /> : undefined}
    >
      <ImportProvider isSignedIn={isSignedIn}>{children}</ImportProvider>
    </AppShell>
  );
}
