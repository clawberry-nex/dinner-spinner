// Config values for the shared experiences. No JSX here so the read-only
// invariants stay unit-testable. fetch/localStorage are only touched inside
// the functions (at call time), so this module is safe to import in tests.
import type { DishType } from "@/lib/dish-types";
import type { Dish } from "@/lib/types";
import type { PlanEntry } from "@/lib/plan-storage";
import { demoLoadDishes, demoLoadTags } from "@/lib/demo/source";

export type ExperienceConfig = {
  loadDishes: (tags: string[], dishType?: DishType) => Promise<Dish[]>;
  loadTags: (dishType?: DishType) => Promise<string[]>;
  hrefBase: string;
  spinnerFiltersKey: string;
  planStorageKey: string;
  persistPlanRemote?: (entries: PlanEntry[]) => void;
  loadPlanRemote?: () => Promise<PlanEntry[] | null>;
  readonly: boolean;
};

export const liveExperienceConfig: ExperienceConfig = {
  loadDishes: async (tags, dishType) => {
    const qs = new URLSearchParams();
    if (tags.length) qs.set("tags", tags.join(","));
    if (dishType) qs.set("dishType", dishType);
    const res = await fetch(qs.size ? `/api/dishes?${qs}` : "/api/dishes");
    if (!res.ok) throw new Error("Could not load dishes");
    return res.json();
  },
  loadTags: async (dishType) => {
    const res = await fetch(dishType ? `/api/tags?dishType=${dishType}` : "/api/tags");
    if (!res.ok) throw new Error("Could not load tags");
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
