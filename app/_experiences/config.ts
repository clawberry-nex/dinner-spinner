// Config values for the shared experiences. No JSX here so the read-only
// invariants stay unit-testable. fetch/localStorage are only touched inside
// the functions (at call time), so this module is safe to import in tests.
import type { Dish } from "@/lib/types";
import type { PlanEntry } from "@/lib/plan-storage";
import { demoLoadDishes, demoLoadTags } from "@/lib/demo/source";

export type ExperienceConfig = {
  loadDishes: (tags: string[]) => Promise<Dish[]>;
  loadTags: () => Promise<string[]>;
  hrefBase: string;
  spinnerFiltersKey: string;
  planStorageKey: string;
  persistPlanRemote?: (entries: PlanEntry[]) => void;
  loadPlanRemote?: () => Promise<PlanEntry[] | null>;
  readonly: boolean;
};

export const liveExperienceConfig: ExperienceConfig = {
  loadDishes: async (tags) => {
    const qs = tags.length ? `?tags=${encodeURIComponent(tags.join(","))}` : "";
    const res = await fetch(`/api/dishes${qs}`);
    return res.json();
  },
  loadTags: async () => {
    const res = await fetch("/api/tags");
    return res.json();
  },
  hrefBase: "",
  spinnerFiltersKey: "spinnerFilters",
  planStorageKey: "mealPlan",
  persistPlanRemote: (entries) => {
    void fetch("/api/meal-plan", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries }),
    }).catch(() => {});
  },
  loadPlanRemote: async () => {
    try {
      const res = await fetch("/api/meal-plan");
      if (!res.ok) return null;
      const d = await res.json();
      return Array.isArray(d?.entries) ? d.entries : null;
    } catch {
      return null;
    }
  },
  readonly: false,
};

export const demoExperienceConfig: ExperienceConfig = {
  loadDishes: demoLoadDishes,
  loadTags: demoLoadTags,
  hrefBase: "/demo",
  spinnerFiltersKey: "demoSpinnerFilters",
  planStorageKey: "demoMealPlan",
  // persistPlanRemote / loadPlanRemote intentionally omitted → ephemeral, no server sync.
  readonly: true,
};
