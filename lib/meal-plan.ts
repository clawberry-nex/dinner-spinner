// Shared meal-plan state. Reads from localStorage for instant UI,
// then fetches from /api/meal-plan to cross-device sync. Writes update
// both localStorage and the server (fire-and-forget PUT). If the user
// isn't admin-authed the server calls return 401 and we fall back to
// localStorage-only mode silently.

"use client";

import { useCallback, useEffect, useState } from "react";

const PLAN_KEY = "mealPlan";

export type PlanEntry = { id: number; servings: number };

export function readPlanLocal(): PlanEntry[] {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PlanEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof e.id === "number" &&
        typeof e.servings === "number",
    );
  } catch {
    return [];
  }
}

function writePlanLocal(plan: PlanEntry[]) {
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  } catch {}
}

async function fetchPlanFromServer(): Promise<PlanEntry[] | null> {
  try {
    const res = await fetch("/api/meal-plan", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { entries?: PlanEntry[] };
    if (!Array.isArray(data.entries)) return null;
    return data.entries;
  } catch {
    return null;
  }
}

async function pushPlanToServer(entries: PlanEntry[]): Promise<boolean> {
  try {
    const res = await fetch("/api/meal-plan", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Low-level one-shot helpers — useful for pages that only need to mutate
// the plan without subscribing (e.g. the "add to plan" button on
// /dishes/[id] and the /dishes index toggle).
export function mutatePlan(
  mutator: (prev: PlanEntry[]) => PlanEntry[],
): PlanEntry[] {
  const prev = readPlanLocal();
  const next = mutator(prev);
  writePlanLocal(next);
  // Fire-and-forget server sync; we don't block the UI on it.
  void pushPlanToServer(next);
  return next;
}

// Hook for pages that render the plan and need to react to changes
// (e.g. /plan). Syncs from server once on mount, then persists every
// mutation to both localStorage and the server.
export function useMealPlan(): {
  plan: PlanEntry[];
  setPlan: (next: PlanEntry[]) => void;
  loading: boolean;
} {
  const [plan, setPlanState] = useState<PlanEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Instant: local.
    setPlanState(readPlanLocal());

    // Then try the server and, if it has something, override.
    let cancelled = false;
    fetchPlanFromServer().then((serverPlan) => {
      if (cancelled) return;
      if (serverPlan !== null) {
        writePlanLocal(serverPlan);
        setPlanState(serverPlan);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const setPlan = useCallback((next: PlanEntry[]) => {
    setPlanState(next);
    writePlanLocal(next);
    void pushPlanToServer(next);
  }, []);

  return { plan, setPlan, loading };
}
