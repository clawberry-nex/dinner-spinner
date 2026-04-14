"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Dish } from "@/lib/types";
import { useMealPlan } from "@/lib/meal-plan";

export default function DishesIndexPage() {
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const { plan, setPlan } = useMealPlan();
  const [activeTags, setActiveTags] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/dishes")
      .then((r) => r.json() as Promise<Dish[]>)
      .then(setDishes)
      .finally(() => setLoading(false));
  }, []);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const d of dishes) for (const t of d.tags) s.add(t);
    return [...s].sort();
  }, [dishes]);

  const filteredDishes = useMemo(() => {
    if (activeTags.length === 0) return dishes;
    return dishes.filter((d) => activeTags.every((t) => d.tags.includes(t)));
  }, [dishes, activeTags]);

  function toggleTag(tag: string) {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  function togglePlan(dish: Dish) {
    const idx = plan.findIndex((p) => p.id === dish.id);
    if (idx >= 0) {
      setPlan(plan.filter((p) => p.id !== dish.id));
    } else {
      setPlan([...plan, { id: dish.id, servings: dish.baseServings }]);
    }
  }

  const inPlan = useMemo(() => new Set(plan.map((p) => p.id)), [plan]);

  if (loading) return <p>Loading dishes…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">All dishes</h1>
        <span className="text-sm text-zinc-500">
          {plan.length > 0 && (
            <>
              <Link href="/plan" className="text-emerald-600 hover:underline">
                {plan.length} in meal plan →
              </Link>
            </>
          )}
        </span>
      </div>

      {allTags.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Filter by tags (must match all)
          </h2>
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => {
              const active = activeTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    active
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-zinc-300 bg-white hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {filteredDishes.length === 0 ? (
        <p className="text-zinc-500">
          {dishes.length === 0
            ? "No dishes yet."
            : "No dishes match the current filter."}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {filteredDishes.map((dish) => {
            const added = inPlan.has(dish.id);
            return (
              <li key={dish.id} className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1">
                  <Link
                    href={`/dishes/${dish.id}`}
                    className="font-medium hover:underline"
                  >
                    {dish.title}
                  </Link>
                  {dish.subtitle && (
                    <div className="text-sm text-zinc-500">
                      {dish.subtitle}
                    </div>
                  )}
                  {dish.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {dish.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] dark:bg-zinc-800"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => togglePlan(dish)}
                  className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    added
                      ? "border border-emerald-600 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                      : "bg-emerald-600 text-white hover:bg-emerald-500"
                  }`}
                >
                  {added ? "✓ in plan" : "+ add to plan"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
