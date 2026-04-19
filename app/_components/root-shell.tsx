"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { AppShell } from "./app-shell";

export function RootShell({ children }: { children: ReactNode }) {
  const [planCount, setPlanCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem("mealPlan");
        const parsed = raw ? JSON.parse(raw) : [];
        setPlanCount(Array.isArray(parsed) ? parsed.length : 0);
      } catch { setPlanCount(0); }
    };
    read();
    const onStorage = (e: StorageEvent) => { if (e.key === "mealPlan") read(); };
    window.addEventListener("storage", onStorage);
    const t = window.setInterval(read, 1500);
    return () => { window.removeEventListener("storage", onStorage); window.clearInterval(t); };
  }, [pathname]);

  return <AppShell planCount={planCount}>{children}</AppShell>;
}
