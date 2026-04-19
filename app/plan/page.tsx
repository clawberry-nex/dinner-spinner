"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "../_components/app-header";
import { Button, StepperButton } from "../_components/ui";
import {
  aggregateIngredients,
  aggregatePantryItems,
  groupByName,
  formatShoppingGroup,
} from "@/lib/ingredients";
import type { Dish } from "@/lib/types";

type Entry = { id: number; servings: number };

export default function PlanPage() {
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [includeOptional, setIncludeOptional] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/dishes").then((r) => r.json()).then(setDishes).catch(() => {});
    fetch("/api/auth/check").then((r) => r.json()).then((j) => setAuthed(!!j?.authenticated)).catch(() => {});
    try {
      const raw = localStorage.getItem("mealPlan");
      if (raw) setEntries(JSON.parse(raw));
    } catch {}
    fetch("/api/meal-plan")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.entries) {
          setEntries(d.entries);
          try { localStorage.setItem("mealPlan", JSON.stringify(d.entries)); } catch {}
        }
      })
      .catch(() => {});
  }, []);

  const write = (next: Entry[]) => {
    setEntries(next);
    try { localStorage.setItem("mealPlan", JSON.stringify(next)); } catch {}
    fetch("/api/meal-plan", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries: next }),
    }).catch(() => {});
  };

  const byId = useMemo(() => new Map(dishes.map((d) => [d.id, d])), [dishes]);
  const dishList = entries
    .map((e) => ({ entry: e, dish: byId.get(e.id) }))
    .filter((x): x is { entry: Entry; dish: Dish } => !!x.dish);

  const { shopping, pantry } = useMemo(() => {
    const groups = dishList.map(({ entry, dish }) => ({
      ingredients: dish.ingredients,
      servings: entry.servings,
      baseServings: dish.baseServings,
    }));
    const agg = aggregateIngredients(groups, { includeOptional });
    const pan = aggregatePantryItems(groups);
    return { shopping: groupByName(agg), pantry: groupByName(pan) };
  }, [dishList, includeOptional]);

  const pushTodoist = async () => {
    setPushing(true); setPushMsg(null);
    try {
      const tasks = shopping.map(formatShoppingGroup);
      const res = await fetch("/api/todoist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tasks }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed");
      setPushMsg({ text: `Created ${j.created} tasks.`, ok: true });
    } catch (err) {
      setPushMsg({ text: err instanceof Error ? err.message : "Failed", ok: false });
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <AppHeader title="Plan" />
      <div className="flex-1 overflow-auto pb-20">
        {!dishList.length ? (
          <div className="mx-4 mt-6 rounded-lg border border-dashed border-rule p-6 text-center text-[14px] text-ink-3">
            No dishes in your plan yet. Spin one and add it from the dish page.
          </div>
        ) : (
          <>
            <section className="px-5 pt-4">
              <h2 className="m-0 text-[20px] italic font-medium text-ink" style={{ fontFamily: "var(--font-disp)" }}>Dishes</h2>
              <ul className="mt-2 flex flex-col divide-y divide-rule-soft rounded-lg border border-rule bg-paper">
                {dishList.map(({ entry, dish }) => (
                  <li key={dish.id} className="flex items-center gap-3 p-3">
                    <Link href={`/dishes/${dish.id}`} className="flex-1 text-[15px] text-ink hover:underline" style={{ fontFamily: "var(--font-disp)" }}>
                      {dish.title}
                    </Link>
                    <StepperButton
                      kind="minus"
                      onClick={() => write(entries.map((e) => (e.id === dish.id ? { ...e, servings: Math.max(1, e.servings - 1) } : e)))}
                      ariaLabel="Fewer"
                    />
                    <span className="min-w-6 text-center text-[14px]" style={{ fontFamily: "var(--font-mono)" }}>{entry.servings}</span>
                    <StepperButton
                      kind="plus"
                      onClick={() => write(entries.map((e) => (e.id === dish.id ? { ...e, servings: e.servings + 1 } : e)))}
                      ariaLabel="More"
                    />
                    <button
                      type="button"
                      onClick={() => write(entries.filter((e) => e.id !== dish.id))}
                      className="px-1 text-[12px] text-warn hover:underline"
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => write([])} className="mt-2 text-[12px] text-ink-3 hover:underline">
                Clear all
              </button>
            </section>

            <section className="px-5 pt-6">
              <div className="flex items-center justify-between">
                <h2 className="m-0 text-[20px] italic font-medium text-ink" style={{ fontFamily: "var(--font-disp)" }}>Shopping list</h2>
                <label className="flex items-center gap-[6px] text-[12px] text-ink-2">
                  <input type="checkbox" checked={includeOptional} onChange={(e) => setIncludeOptional(e.target.checked)} />
                  include optional
                </label>
              </div>
              {shopping.length ? (
                <ul className="mt-2 list-disc pl-5 text-[14px]">
                  {shopping.map((g, i) => <li key={i} className="my-[2px]">{formatShoppingGroup(g)}</li>)}
                </ul>
              ) : (
                <div className="mt-2 text-[13px] text-ink-3">No ingredients across these dishes.</div>
              )}
              {shopping.length > 0 && authed ? (
                <div className="mt-3">
                  <Button variant="primary" size="md" onClick={pushTodoist} disabled={pushing}>
                    {pushing ? "Sending…" : "Send to Todoist"}
                  </Button>
                  {pushMsg && (
                    <div className={["mt-2 text-[12px]", pushMsg.ok ? "text-good" : "text-warn"].join(" ")}>
                      {pushMsg.text}
                    </div>
                  )}
                </div>
              ) : null}
            </section>

            {pantry.length > 0 && (
              <section className="px-5 pt-6">
                <h2 className="m-0 text-[18px] italic font-medium text-ink-2" style={{ fontFamily: "var(--font-disp)" }}>Pantry check ({pantry.length})</h2>
                <p className="mt-1 text-[12px] text-ink-3">
                  Skipped from the shopping list because you already have them. Glance over to make sure you&rsquo;re not running low.
                </p>
                <ul className="mt-2 list-disc pl-5 text-[14px] italic text-ink-3">
                  {pantry.map((g, i) => (
                    <li key={i} className="my-[2px]">
                      <span className="not-italic text-ink-3" style={{ fontFamily: "var(--font-mono)" }}>
                        {formatShoppingGroup(g)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
