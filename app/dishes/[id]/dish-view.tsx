"use client";

import { useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import type { Dish } from "@/lib/types";
import { formatQty, scaleIngredient } from "@/lib/ingredients";
import type { Ingredient } from "@/lib/types";

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

export default function DishView({ dish }: { dish: Dish }) {
  const [servings, setServings] = useState<number>(dish.baseServings);
  const [addedMsg, setAddedMsg] = useState<string | null>(null);

  function addToPlan() {
    const plan = readPlan();
    const existing = plan.findIndex((p) => p.id === dish.id);
    if (existing >= 0) {
      plan[existing] = { id: dish.id, servings };
    } else {
      plan.push({ id: dish.id, servings });
    }
    writePlan(plan);
    setAddedMsg(`Added to meal plan (${plan.length} dishes).`);
    setTimeout(() => setAddedMsg(null), 2500);
  }

  return (
    <div className="flex flex-col gap-8">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← Back to spinner
      </Link>

      <header>
        <h1 className="text-3xl font-bold">{dish.title}</h1>
        {dish.subtitle && (
          <p className="mt-1 text-lg text-zinc-600 dark:text-zinc-400">
            {dish.subtitle}
          </p>
        )}
        {dish.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {dish.tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs dark:bg-zinc-800"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </header>

      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-4 flex items-center gap-3">
          <span className="font-semibold">Serves:</span>
          <button
            type="button"
            onClick={() => setServings((s) => Math.max(1, s - 1))}
            className="h-8 w-8 rounded border border-zinc-300 dark:border-zinc-700"
          >
            −
          </button>
          <span className="w-8 text-center font-mono text-lg">{servings}</span>
          <button
            type="button"
            onClick={() => setServings((s) => s + 1)}
            className="h-8 w-8 rounded border border-zinc-300 dark:border-zinc-700"
          >
            +
          </button>
          <span className="ml-2 text-xs text-zinc-500">
            (base: {dish.baseServings})
          </span>
          <button
            type="button"
            onClick={addToPlan}
            className="ml-auto rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Add to meal plan
          </button>
        </div>
        {addedMsg && <p className="mb-2 text-sm text-emerald-600">{addedMsg}</p>}

        {dish.ingredients.length > 0 ? (
          <ul className="list-disc space-y-1 pl-6">
            {dish.ingredients.map((ing, i) => {
              const scaled: Ingredient = scaleIngredient(
                ing,
                servings,
                dish.baseServings,
              );
              return (
                <li key={i}>
                  <span className="font-mono">
                    {formatQty(scaled.quantity)}
                  </span>
                  {scaled.unit ? ` ${scaled.unit}` : ""}
                  {scaled.descriptor ? ` ${scaled.descriptor}` : ""}{" "}
                  {scaled.name}
                  {scaled.preparation && (
                    <span className="text-zinc-500">
                      , {scaled.preparation}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-zinc-500">No ingredients listed.</p>
        )}
      </section>

      {dish.recipe && (
        <section className="prose prose-zinc max-w-none dark:prose-invert">
          <h2 className="text-xl font-semibold">Recipe</h2>
          <ReactMarkdown>{dish.recipe}</ReactMarkdown>
        </section>
      )}
    </div>
  );
}
