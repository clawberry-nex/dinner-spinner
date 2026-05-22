"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "../_components/app-header";
import { Button, DishArt, StepperButton } from "../_components/ui";
import { Icon } from "../_components/icon";
import {
  aggregateIngredients,
  aggregatePantryItems,
  formatShoppingGroup,
  groupByName,
  groupKey,
  splicePantryToShopping,
  type ShoppingGroup,
} from "@/lib/ingredients";
import {
  DAY_LABELS,
  DAY_LABELS_LONG,
  entryDay,
  groupByDay,
  moveEntry,
  resetWeek,
} from "@/lib/week-plan";
import type { Dish } from "@/lib/types";

type Entry = { id: number; servings: number; day?: number | null };

export default function PlanPage() {
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [includeOptional, setIncludeOptional] = useState(false);
  // Ephemeral: groups the user has flagged as "I'm actually out of this
  // pantry staple" — moves them from the pantry section onto the shopping
  // list (and into the Todoist push) for THIS planning session only.
  const [outOfStock, setOutOfStock] = useState<ReadonlySet<string>>(new Set());
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/dishes").then((r) => r.json()).then(setDishes).catch(() => {});
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

  const grouped = useMemo(() => groupByDay(entries), [entries]);

  const { shopping, pantry } = useMemo(() => {
    const groups = dishList.map(({ entry, dish }) => ({
      ingredients: dish.ingredients,
      servings: entry.servings,
      baseServings: dish.baseServings,
    }));
    const agg = aggregateIngredients(groups, { includeOptional });
    const pan = aggregatePantryItems(groups);
    return splicePantryToShopping(groupByName(agg), groupByName(pan), outOfStock);
  }, [dishList, includeOptional, outOfStock]);

  const markOutOfStock = (group: ShoppingGroup) =>
    setOutOfStock((prev) => {
      const next = new Set(prev);
      next.add(groupKey(group));
      return next;
    });
  const restoreToPantry = (group: ShoppingGroup) =>
    setOutOfStock((prev) => {
      const next = new Set(prev);
      next.delete(groupKey(group));
      return next;
    });

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

  const moveToDay = (dishId: number, day: number | null) =>
    write(moveEntry(entries, dishId, day));
  const changeServings = (dishId: number, delta: number) =>
    write(entries.map((e) => (e.id === dishId ? { ...e, servings: Math.max(1, e.servings + delta) } : e)));
  const removeFromPlan = (dishId: number) =>
    write(entries.filter((e) => e.id !== dishId));

  const hasEntries = entries.length > 0;
  const hasAssignments = entries.some((e) => entryDay(e) !== null);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <AppHeader title="Plan" />
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-20">
       <div className="mx-auto w-full max-w-6xl">
        {!hasEntries ? (
          <div className="mx-4 mt-6 rounded-lg border border-dashed border-rule p-6 text-center text-[14px] text-ink-3">
            No dishes in your plan yet. Spin one and add it from the dish page.
          </div>
        ) : (
          <div className="flex flex-col gap-6 px-5 pt-4">
            <section>
              <div className="flex items-center justify-between">
                <h2 className="m-0 text-[20px] italic font-medium text-ink" style={{ fontFamily: "var(--font-disp)" }}>Week</h2>
                <div className="flex gap-3 text-[12px]">
                  {hasAssignments && (
                    <button
                      type="button"
                      onClick={() => write(resetWeek(entries))}
                      className="text-ink-3 hover:underline"
                    >
                      Reset week
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => write([])}
                    className="text-warn hover:underline"
                  >
                    Clear all
                  </button>
                </div>
              </div>
              <p className="mt-1 text-[12px] text-ink-3">
                Tap the day chips on a dish to slot it into the week. Unassigned dishes sit in the pool and still count for the shopping list.
              </p>

              <div className="mt-3 flex flex-col gap-3">
                <DayColumn
                  label="Pool"
                  sublabel="Unassigned"
                  entries={grouped.pool}
                  byId={byId}
                  onMove={moveToDay}
                  onServings={changeServings}
                  onRemove={removeFromPlan}
                  activeDay={null}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-7">
                  {DAY_LABELS.map((short, i) => (
                    <DayColumn
                      key={i}
                      label={short}
                      sublabel={DAY_LABELS_LONG[i]}
                      entries={grouped.days[i]}
                      byId={byId}
                      onMove={moveToDay}
                      onServings={changeServings}
                      onRemove={removeFromPlan}
                      activeDay={i}
                    />
                  ))}
                </div>
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between">
                <h2 className="m-0 text-[20px] italic font-medium text-ink" style={{ fontFamily: "var(--font-disp)" }}>Shopping list</h2>
                <label className="flex items-center gap-[6px] text-[12px] text-ink-2">
                  <input type="checkbox" checked={includeOptional} onChange={(e) => setIncludeOptional(e.target.checked)} />
                  include optional
                </label>
              </div>
              {shopping.length ? (
                <ul className="mt-2 list-disc pl-5 text-[14px]">
                  {shopping.map((g) => {
                    const fromPantry = outOfStock.has(groupKey(g));
                    return (
                      <li key={groupKey(g)} className="my-[2px]">
                        {formatShoppingGroup(g)}
                        {fromPantry && (
                          <>
                            {" "}
                            <span className="text-[11px] text-ink-3" style={{ fontFamily: "var(--font-mono)" }}>
                              (from pantry)
                            </span>{" "}
                            <button
                              type="button"
                              onClick={() => restoreToPantry(g)}
                              aria-label={`Move ${g.name} back to pantry`}
                              className="text-[11px] text-ink-3 hover:underline"
                            >
                              undo
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="mt-2 text-[13px] text-ink-3">No ingredients across these dishes.</div>
              )}
              {shopping.length > 0 ? (
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
              <section>
                <h2 className="m-0 text-[18px] italic font-medium text-ink-2" style={{ fontFamily: "var(--font-disp)" }}>Pantry check ({pantry.length})</h2>
                <p className="mt-1 text-[12px] text-ink-3">
                  Skipped from the shopping list because you already have them. Glance over to make sure you&rsquo;re not running low.
                </p>
                <ul className="mt-2 list-disc pl-5 text-[14px] italic text-ink-3">
                  {pantry.map((g) => (
                    <li key={groupKey(g)} className="my-[2px] flex items-center gap-2">
                      <span className="not-italic text-ink-3" style={{ fontFamily: "var(--font-mono)" }}>
                        {formatShoppingGroup(g)}
                      </span>
                      <button
                        type="button"
                        onClick={() => markOutOfStock(g)}
                        aria-label={`Add ${g.name} to shopping list`}
                        title="I'm actually out of this — add to shopping list"
                        className="rounded-pill border border-rule px-[8px] py-[1px] text-[10px] not-italic uppercase tracking-[0.08em] text-ink-3 hover:border-ink-3 hover:text-ink-2"
                      >
                        + to list
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
       </div>
      </div>
    </div>
  );
}

function DayColumn({
  label,
  sublabel,
  entries,
  byId,
  onMove,
  onServings,
  onRemove,
  activeDay,
}: {
  label: string;
  sublabel: string;
  entries: Entry[];
  byId: Map<number, Dish>;
  onMove: (dishId: number, day: number | null) => void;
  onServings: (dishId: number, delta: number) => void;
  onRemove: (dishId: number) => void;
  activeDay: number | null;
}) {
  const dishList = entries
    .map((e) => ({ entry: e, dish: byId.get(e.id) }))
    .filter((x): x is { entry: Entry; dish: Dish } => !!x.dish);

  return (
    <div className="rounded-lg border border-rule bg-paper p-2">
      <div className="flex items-baseline justify-between px-1 pb-1">
        <span
          className="text-[13px] font-medium italic text-ink"
          style={{ fontFamily: "var(--font-disp)" }}
          title={sublabel}
        >
          {label}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-ink-3">
          {dishList.length || ""}
        </span>
      </div>
      {dishList.length === 0 ? (
        <div className="py-3 text-center text-[11px] text-ink-3">—</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {dishList.map(({ entry, dish }) => (
            <li key={dish.id}>
              <DishCard
                dish={dish}
                entry={entry}
                onMove={onMove}
                onServings={onServings}
                onRemove={onRemove}
                activeDay={activeDay}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DishCard({
  dish,
  entry,
  onMove,
  onServings,
  onRemove,
  activeDay,
}: {
  dish: Dish;
  entry: Entry;
  onMove: (dishId: number, day: number | null) => void;
  onServings: (dishId: number, delta: number) => void;
  onRemove: (dishId: number) => void;
  activeDay: number | null;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-rule-soft bg-bg p-2">
      <div className="flex items-center gap-2">
        <DishArt dish={dish} size={28} corner="var(--radius-sm)" />
        <Link
          href={`/dishes/${dish.id}`}
          className="min-w-0 flex-1 truncate text-[13px] text-ink hover:underline"
          style={{ fontFamily: "var(--font-disp)" }}
          title={dish.title}
        >
          {dish.title}
        </Link>
        <button
          type="button"
          onClick={() => onRemove(dish.id)}
          className="grid h-5 w-5 place-items-center text-ink-3 hover:text-warn"
          aria-label="Remove from plan"
        >
          <Icon name="x" size={12} />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <StepperButton kind="minus" onClick={() => onServings(dish.id, -1)} ariaLabel="Fewer" />
        <span className="min-w-6 text-center text-[12px]" style={{ fontFamily: "var(--font-mono)" }}>
          {entry.servings}
        </span>
        <StepperButton kind="plus" onClick={() => onServings(dish.id, 1)} ariaLabel="More" />
        <span className="ml-auto text-[10px] text-ink-3">servings</span>
      </div>

      <DayPicker activeDay={activeDay} onPick={(d) => onMove(dish.id, d)} />
    </div>
  );
}

function DayPicker({
  activeDay,
  onPick,
}: {
  activeDay: number | null;
  onPick: (day: number | null) => void;
}) {
  const base =
    "inline-flex h-6 min-w-[22px] items-center justify-center rounded-sm text-[10px] font-medium transition-colors";
  const inactive = "bg-bg-alt text-ink-3 hover:bg-rule-soft";
  const active = "bg-ink text-paper";
  return (
    <div className="flex flex-wrap gap-[3px]">
      <button
        type="button"
        onClick={() => onPick(null)}
        className={`${base} px-[6px] ${activeDay === null ? active : inactive}`}
        aria-label="Move to pool"
        aria-pressed={activeDay === null}
      >
        Pool
      </button>
      {DAY_LABELS.map((d, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPick(i)}
          className={`${base} px-[4px] ${activeDay === i ? active : inactive}`}
          aria-label={`Move to ${DAY_LABELS_LONG[i]}`}
          aria-pressed={activeDay === i}
          title={DAY_LABELS_LONG[i]}
        >
          {d[0]}
        </button>
      ))}
    </div>
  );
}
