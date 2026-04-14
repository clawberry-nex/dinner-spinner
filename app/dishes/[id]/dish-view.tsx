"use client";

import { useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import type { Dish } from "@/lib/types";
import { formatQty, scaleIngredient, visibleUnit } from "@/lib/ingredients";
import type { Ingredient } from "@/lib/types";
import { mutatePlan } from "@/lib/meal-plan";

export default function DishView({ dish }: { dish: Dish }) {
  const [servings, setServings] = useState<number>(dish.baseServings);
  const [addedMsg, setAddedMsg] = useState<string | null>(null);

  function addToPlan() {
    const next = mutatePlan((prev) => {
      const existing = prev.findIndex((p) => p.id === dish.id);
      if (existing >= 0) {
        const copy = [...prev];
        copy[existing] = { id: dish.id, servings };
        return copy;
      }
      return [...prev, { id: dish.id, servings }];
    });
    setAddedMsg(`Added to meal plan (${next.length} dishes).`);
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
          <Link
            href={`/dishes/${dish.id}/cook?servings=${servings}`}
            className="ml-auto rounded-md border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950"
          >
            Cook mode
          </Link>
          <button
            type="button"
            onClick={addToPlan}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
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
              const pantry = !!scaled.pantry;
              const optional = !!scaled.optional;
              const fixed = scaled.scalable === false;
              const unit = visibleUnit(scaled.unit);
              return (
                <li
                  key={i}
                  className={pantry ? "italic text-zinc-400 dark:text-zinc-500" : ""}
                >
                  <span className="font-mono">
                    {formatQty(scaled.quantity)}
                  </span>
                  {unit ? ` ${unit}` : ""}
                  {scaled.descriptor ? ` ${scaled.descriptor}` : ""}{" "}
                  {scaled.name}
                  {scaled.alternatives && scaled.alternatives.length > 0 && (
                    <span className="text-zinc-500">
                      {" "}
                      (or {scaled.alternatives.join(", ")})
                    </span>
                  )}
                  {scaled.preparation && (
                    <span className={pantry ? "" : "text-zinc-500"}>
                      , {scaled.preparation}
                    </span>
                  )}
                  {optional && (
                    <span className="ml-1 text-xs text-zinc-500">
                      (optional)
                    </span>
                  )}
                  {fixed && (
                    <span className="ml-2 rounded-full border border-zinc-300 px-1.5 py-0.5 text-[10px] uppercase not-italic tracking-wide text-zinc-500 dark:border-zinc-700">
                      fixed
                    </span>
                  )}
                  {pantry && (
                    <span className="ml-2 rounded-full border border-zinc-300 px-1.5 py-0.5 text-[10px] uppercase not-italic tracking-wide text-zinc-500 dark:border-zinc-700">
                      pantry
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
