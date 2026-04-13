"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Dish, Ingredient } from "@/lib/types";
import {
  aggregateIngredients,
  aggregatePantryItems,
  formatQty,
  visibleUnit,
} from "@/lib/ingredients";

const PLAN_KEY = "mealPlan";

type PlanEntry = { id: number; servings: number };

function readPlan(): PlanEntry[] {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PlanEntry[];
  } catch {
    return [];
  }
}

function writePlan(plan: PlanEntry[]) {
  localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
}

export default function PlanPage() {
  const [plan, setPlan] = useState<PlanEntry[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendState, setSendState] = useState<
    { kind: "idle" } | { kind: "sending" } | { kind: "ok"; count: number } | { kind: "err"; msg: string }
  >({ kind: "idle" });

  useEffect(() => {
    const p = readPlan();
    setPlan(p);
    if (p.length === 0) {
      setLoading(false);
      return;
    }
    fetch(`/api/dishes`)
      .then((r) => r.json() as Promise<Dish[]>)
      .then((all) => setDishes(all.filter((d) => p.some((e) => e.id === d.id))))
      .finally(() => setLoading(false));
  }, []);

  const planWithDish = useMemo(
    () =>
      plan
        .map((e) => ({ entry: e, dish: dishes.find((d) => d.id === e.id) }))
        .filter((x): x is { entry: PlanEntry; dish: Dish } => !!x.dish),
    [plan, dishes],
  );

  const groupedForAggregation = useMemo(
    () =>
      planWithDish.map(({ entry, dish }) => ({
        ingredients: dish.ingredients,
        servings: entry.servings,
        baseServings: dish.baseServings,
      })),
    [planWithDish],
  );

  const shoppingList: Ingredient[] = useMemo(
    () => aggregateIngredients(groupedForAggregation),
    [groupedForAggregation],
  );

  const pantryList: Ingredient[] = useMemo(
    () => aggregatePantryItems(groupedForAggregation),
    [groupedForAggregation],
  );

  function updateServings(id: number, delta: number) {
    const next = plan
      .map((e) =>
        e.id === id ? { ...e, servings: Math.max(1, e.servings + delta) } : e,
      );
    setPlan(next);
    writePlan(next);
  }

  function remove(id: number) {
    const next = plan.filter((e) => e.id !== id);
    setPlan(next);
    writePlan(next);
    setDishes((ds) => ds.filter((d) => d.id !== id));
  }

  function clearAll() {
    setPlan([]);
    setDishes([]);
    writePlan([]);
  }

  async function sendToTodoist() {
    setSendState({ kind: "sending" });
    try {
      const res = await fetch("/api/todoist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ingredients: shoppingList }),
      });
      const data = (await res.json()) as { ok?: boolean; created?: number; error?: string };
      if (!res.ok || !data.ok) {
        setSendState({ kind: "err", msg: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setSendState({ kind: "ok", count: data.created ?? 0 });
    } catch (e) {
      setSendState({ kind: "err", msg: e instanceof Error ? e.message : "Error" });
    }
  }

  if (loading) return <p>Loading meal plan…</p>;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-bold">Meal plan</h1>

      {planWithDish.length === 0 ? (
        <p className="text-zinc-500">
          No dishes in your plan yet. Spin one and add it from the dish page.
        </p>
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-xl font-semibold">Dishes</h2>
            <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {planWithDish.map(({ entry, dish }) => (
                <li
                  key={dish.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <Link
                    href={`/dishes/${dish.id}`}
                    className="flex-1 font-medium hover:underline"
                  >
                    {dish.title}
                  </Link>
                  <button
                    type="button"
                    onClick={() => updateServings(dish.id, -1)}
                    className="h-7 w-7 rounded border border-zinc-300 dark:border-zinc-700"
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-mono">
                    {entry.servings}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateServings(dish.id, +1)}
                    className="h-7 w-7 rounded border border-zinc-300 dark:border-zinc-700"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(dish.id)}
                    className="ml-2 text-sm text-red-600 hover:underline"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={clearAll}
              className="mt-2 text-sm text-zinc-500 hover:underline"
            >
              Clear all
            </button>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">Shopping list</h2>
            {shoppingList.length === 0 ? (
              <p className="text-zinc-500">No ingredients across these dishes.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-6">
                {shoppingList.map((ing, i) => {
                  const unit = visibleUnit(ing.unit);
                  return (
                    <li key={i}>
                      <span className="font-mono">{formatQty(ing.quantity)}</span>
                      {unit ? ` ${unit}` : ""}
                      {ing.descriptor ? ` ${ing.descriptor}` : ""} {ing.name}
                    </li>
                  );
                })}
              </ul>
            )}
            {shoppingList.length > 0 && (
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={sendToTodoist}
                  disabled={sendState.kind === "sending"}
                  className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-70"
                >
                  {sendState.kind === "sending"
                    ? "Sending…"
                    : "Send to Todoist"}
                </button>
                {sendState.kind === "ok" && (
                  <span className="text-emerald-600">
                    Created {sendState.count} tasks.
                  </span>
                )}
                {sendState.kind === "err" && (
                  <span className="text-red-600">{sendState.msg}</span>
                )}
              </div>
            )}
          </section>

          {pantryList.length > 0 && (
            <section>
              <h2 className="mb-1 text-xl font-semibold text-zinc-600 dark:text-zinc-400">
                Pantry check ({pantryList.length})
              </h2>
              <p className="mb-3 text-xs text-zinc-500">
                Skipped from the shopping list because you already have
                them. Glance over to make sure you&rsquo;re not running low.
              </p>
              <ul className="list-disc space-y-1 pl-6 italic text-zinc-500">
                {pantryList.map((ing, i) => {
                  const unit = visibleUnit(ing.unit);
                  return (
                    <li key={i}>
                      <span className="font-mono not-italic">
                        {formatQty(ing.quantity)}
                      </span>
                      {unit ? ` ${unit}` : ""}
                      {ing.descriptor ? ` ${ing.descriptor}` : ""} {ing.name}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
