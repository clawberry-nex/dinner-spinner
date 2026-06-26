"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DishArt, useToast } from "../_components/ui";
import { Icon } from "../_components/icon";
import {
  aggregateIngredients,
  aggregatePantryItems,
  formatQty,
  groupByName,
  groupKey,
  splicePantryToShopping,
  visibleUnit,
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
import { useExperienceConfig } from "./experience-config";
import { readPlan, writePlan } from "@/lib/plan-storage";

type Entry = { id: number; servings: number; day?: number | null };

export function PlanExperience() {
  const cfg = useExperienceConfig();
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [includeOptional, setIncludeOptional] = useState(false);
  // Ephemeral: groups the user has flagged as "I'm actually out of this
  // pantry staple" — moves them from the pantry section onto the shopping
  // list (and into the Todoist push) for THIS planning session only.
  const [outOfStock, setOutOfStock] = useState<ReadonlySet<string>>(new Set());
  // Ephemeral: shopping groups the user has already grabbed ("in the basket").
  // Keyed by groupKey so the set survives re-aggregation. Checked items drop
  // to the "Got" section and are left out of the Todoist push.
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [showDishes, setShowDishes] = useState(true);
  const [pushing, setPushing] = useState(false);
  const toast = useToast();

  useEffect(() => {
    cfg.loadDishes([]).then(setDishes).catch(() => {});
    setEntries(readPlan(cfg.planStorageKey) as Entry[]);
    cfg.loadPlanRemote?.().then((remote) => {
      if (remote) {
        setEntries(remote as Entry[]);
        writePlan(cfg.planStorageKey, remote);
      }
    }).catch(() => {});
  }, [cfg]);

  const write = (next: Entry[]) => {
    setEntries(next);
    writePlan(cfg.planStorageKey, next);
    cfg.persistPlanRemote?.(next);
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

  const totalServings = dishList.reduce((a, x) => a + x.entry.servings, 0);
  const toGet = shopping.filter((g) => !checked.has(groupKey(g)));
  const got = shopping.filter((g) => checked.has(groupKey(g)));
  const remaining = toGet.length;

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
  const toggleChecked = (group: ShoppingGroup) =>
    setChecked((prev) => {
      const key = groupKey(group);
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const pushTodoist = async () => {
    if (pushing || remaining === 0) return;
    setPushing(true);
    try {
      // Only push items the user still needs — checked ("got") items are left off.
      const tasks = toGet.map(formatShoppingGroupLine);
      const res = await fetch("/api/todoist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tasks }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed");
      toast.show(`Pushed ${j.created} task${j.created !== 1 ? "s" : ""} to Todoist`);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn’t reach Todoist");
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
  const clearPlan = () => {
    write([]);
    setChecked(new Set());
    setOutOfStock(new Set());
    toast.show("List cleared");
  };

  const hasEntries = entries.length > 0;
  const hasAssignments = entries.some((e) => entryDay(e) !== null);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-24 lg:pb-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col px-5 pt-[var(--safe-top)] lg:px-10">
          {/* Header section — no AppHeader; the shell owns the brand chrome. */}
          <div className="flex items-end justify-between gap-4 lg:mt-2">
            <div className="min-w-0">
              <div className="mb-[10px] text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
                Shopping
              </div>
              <h1
                className="m-0 font-medium leading-[1.04] tracking-[-0.02em] text-text"
                style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(30px,6vw,42px)" }}
              >
                Your list
              </h1>
              {hasEntries && (
                <div className="mt-2 text-[13.5px] text-text-dim lg:text-[15px]">
                  {dishList.length} {dishList.length === 1 ? "dish" : "dishes"} · {totalServings} serving{totalServings === 1 ? "" : "s"} · {shopping.length} to buy
                </div>
              )}
            </div>
            {hasEntries && (
              <button
                type="button"
                onClick={clearPlan}
                className="inline-flex shrink-0 items-center gap-[6px] rounded-pill border border-line bg-surface-2 px-[14px] py-[9px] text-[13px] font-semibold text-text-dim transition-colors hover:border-line-2 hover:text-text"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                <Icon name="close" size={14} />Clear all
              </button>
            )}
          </div>

          {!hasEntries ? (
            <EmptyState />
          ) : (
            <div className="mt-6 flex flex-col gap-0 lg:mt-8 lg:grid lg:grid-cols-[minmax(300px,380px)_1fr] lg:items-start lg:gap-10">
              {/* ───── Left rail (desktop) / top stack (mobile): planned week ───── */}
              <div className="min-w-0">
                {/* summary card */}
                <div className="flex overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface py-[14px] shadow-[var(--shadow-card)]">
                  <SummaryStat n={dishList.length} label={dishList.length === 1 ? "dish" : "dishes"} />
                  <Divider />
                  <SummaryStat n={totalServings} label="servings" />
                  <Divider />
                  <SummaryStat n={remaining} label="to buy" />
                </div>

                {/* planned dishes — the week planner, collapsible */}
                <button
                  type="button"
                  onClick={() => setShowDishes((s) => !s)}
                  className="mt-[18px] flex w-full items-center justify-between bg-transparent px-[2px] pb-[10px] text-left"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-faint">
                    Cooking {dishList.length} {dishList.length === 1 ? "dish" : "dishes"}
                  </span>
                  <span className="flex items-center gap-3">
                    {hasAssignments && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); write(resetWeek(entries)); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); write(resetWeek(entries)); } }}
                        className="cursor-pointer text-[11.5px] font-medium text-text-dim hover:text-text"
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        Reset week
                      </span>
                    )}
                    <Icon name={showDishes ? "chevU" : "chevD"} size={16} style={{ color: "var(--text-faint)" }} />
                  </span>
                </button>

                {showDishes && (
                  <div className="flex flex-col gap-[10px]">
                    <p className="px-[2px] text-[12px] leading-[1.5] text-text-faint">
                      Tap the day chips to slot a dish into the week. Unassigned dishes sit in the pool and still count for the shopping list.
                    </p>
                    <DayGroup
                      label="Pool"
                      sublabel="Unassigned"
                      entries={grouped.pool}
                      byId={byId}
                      onMove={moveToDay}
                      onServings={changeServings}
                      onRemove={removeFromPlan}
                      activeDay={null}
                    />
                    {DAY_LABELS.map((short, i) =>
                      grouped.days[i].length > 0 ? (
                        <DayGroup
                          key={i}
                          label={DAY_LABELS_LONG[i]}
                          sublabel={short}
                          entries={grouped.days[i]}
                          byId={byId}
                          onMove={moveToDay}
                          onServings={changeServings}
                          onRemove={removeFromPlan}
                          activeDay={i}
                        />
                      ) : null,
                    )}
                  </div>
                )}

                {/* pantry check — desktop sits in the left rail; mobile flows after the list */}
                {pantry.length > 0 && (
                  <div className="mt-5 hidden lg:block">
                    <PantryCheck pantry={pantry} outOfStock={outOfStock} onToggle={(g) => (outOfStock.has(groupKey(g)) ? restoreToPantry(g) : markOutOfStock(g))} />
                  </div>
                )}
              </div>

              {/* ───── Right (desktop) / below (mobile): the shopping list hero ───── */}
              <div className="mt-7 min-w-0 lg:mt-0">
                <div className="mb-[14px] flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Shopping list</div>
                    <div className="mt-[6px] text-[12.5px] text-text-faint">
                      {checked.size > 0
                        ? `${remaining} still to buy · ${checked.size} in the basket`
                        : "Tick anything you already have to leave it off"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIncludeOptional((v) => !v)}
                    aria-pressed={includeOptional}
                    className={[
                      "inline-flex shrink-0 items-center gap-[6px] rounded-pill border px-[13px] py-[8px] text-[12.5px] font-semibold transition-colors",
                      includeOptional
                        ? "border-accent-line bg-accent-tint text-accent-2"
                        : "border-line bg-transparent text-text-dim hover:border-line-2 hover:text-text",
                    ].join(" ")}
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    <Icon name={includeOptional ? "check" : "plus"} size={14} />optional
                  </button>
                </div>

                <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-card)]">
                  {shopping.length === 0 ? (
                    <div className="px-6 py-7 text-center text-[13.5px] text-text-faint">
                      Everything’s a pantry staple — nothing to buy.
                    </div>
                  ) : (
                    <>
                      {toGet.map((g, i) => (
                        <ShoppingRow
                          key={groupKey(g)}
                          group={g}
                          done={false}
                          last={i === toGet.length - 1 && got.length === 0}
                          fromPantry={outOfStock.has(groupKey(g))}
                          onToggle={() => toggleChecked(g)}
                          onUndoPantry={() => restoreToPantry(g)}
                        />
                      ))}
                      {got.length > 0 && (
                        <div className="flex items-center gap-2 border-y border-line bg-surface-2 px-4 py-[9px]">
                          <Icon name="basket" size={13} style={{ color: "var(--text-faint)" }} />
                          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-faint">
                            In the basket · {got.length}
                          </span>
                        </div>
                      )}
                      {got.map((g, i) => (
                        <ShoppingRow
                          key={groupKey(g)}
                          group={g}
                          done
                          last={i === got.length - 1}
                          fromPantry={outOfStock.has(groupKey(g))}
                          onToggle={() => toggleChecked(g)}
                          onUndoPantry={() => restoreToPantry(g)}
                        />
                      ))}
                    </>
                  )}
                </div>

                {/* pantry check — mobile only (desktop renders it in the left rail) */}
                {pantry.length > 0 && (
                  <div className="mt-5 lg:hidden">
                    <PantryCheck pantry={pantry} outOfStock={outOfStock} onToggle={(g) => (outOfStock.has(groupKey(g)) ? restoreToPantry(g) : markOutOfStock(g))} />
                  </div>
                )}

                {/* Send to Todoist (read-only demo → sign-up nudge) */}
                {cfg.readonly ? (
                  <Link
                    href="/auth/signup"
                    className="mt-[22px] flex h-[54px] w-full items-center justify-center gap-[10px] rounded-pill bg-accent text-[15px] font-semibold text-accent-ink"
                    style={{ fontFamily: "var(--font-sans)", letterSpacing: 0.2 }}
                  >
                    <Icon name="todoist" size={20} />Create an account to send to Todoist
                  </Link>
                ) : (
                <button
                  type="button"
                  onClick={pushTodoist}
                  disabled={pushing || remaining === 0}
                  className="mt-[22px] flex h-[54px] w-full items-center justify-center gap-[10px] rounded-pill bg-accent text-[15px] font-semibold text-accent-ink transition-opacity disabled:opacity-50"
                  style={{ fontFamily: "var(--font-sans)", letterSpacing: 0.2 }}
                >
                  {pushing ? (
                    <><SpinnerGlyph />Pushing…</>
                  ) : remaining === 0 ? (
                    <><Icon name="check" size={20} />Got everything already</>
                  ) : (
                    <><Icon name="todoist" size={20} />Send {remaining} to Todoist</>
                  )}
                </button>
                )}
                <p className="mt-[11px] text-center text-[12px] leading-[1.5] text-text-faint">
                  {cfg.readonly
                    ? "This is a read-only demo — sign up to push your list to Todoist."
                    : remaining === 0
                    ? "You already have everything — nothing to buy."
                    : `Sends the ${remaining} item${remaining !== 1 ? "s" : ""} you still need as tasks to your Todoist project. Prep detail (“finely diced”) is left off — it’s about what to buy.`}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      {toast.el}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Shopping-list line for a group: "2 can + 400 ml coconut milk".
// Local copy of the qty/unit join (formatShoppingGroup, but used here
// both for the Todoist task content and the rendered amount).
// ─────────────────────────────────────────────────────────────
function formatAmounts(group: ShoppingGroup): string {
  return group.items
    .map((ing) => {
      const qty = formatQty(ing.quantity);
      const unit = visibleUnit(ing.unit);
      return unit ? `${qty} ${unit}` : qty;
    })
    .join(" + ");
}
function formatShoppingGroupLine(group: ShoppingGroup): string {
  const parts = [formatAmounts(group)];
  if (group.descriptor) parts.push(group.descriptor);
  parts.push(group.name);
  return parts.join(" ");
}

// ─────────────────────────────────────────────────────────────
// Summary stat — serif numeral over an eyebrow label.
// ─────────────────────────────────────────────────────────────
function SummaryStat({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex-1 text-center">
      <div className="tnum font-semibold leading-none text-text" style={{ fontFamily: "var(--font-serif)", fontSize: 24 }}>
        {n}
      </div>
      <div className="mt-[6px] text-[9.5px] font-semibold uppercase tracking-[0.14em] text-text-faint">{label}</div>
    </div>
  );
}
function Divider() {
  return <div className="my-[2px] w-px bg-line" />;
}

// ─────────────────────────────────────────────────────────────
// Shopping row — checkbox circle + name + amount. Tapping anywhere
// toggles "got". A "from pantry" row gets an undo affordance.
// ─────────────────────────────────────────────────────────────
function ShoppingRow({
  group,
  done,
  last,
  fromPantry,
  onToggle,
  onUndoPantry,
}: {
  group: ShoppingGroup;
  done: boolean;
  last: boolean;
  fromPantry: boolean;
  onToggle: () => void;
  onUndoPantry: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      aria-pressed={done}
      className={["flex cursor-pointer items-center gap-3 px-4 py-[12px] transition-colors hover:bg-surface-2", last ? "" : "border-b border-line"].join(" ")}
    >
      <span
        className="grid h-[20px] w-[20px] shrink-0 place-items-center rounded-[6px] transition-colors"
        style={{
          border: done ? "none" : "1.5px solid var(--line-2)",
          background: done ? "var(--sage)" : "transparent",
        }}
      >
        {done && <Icon name="check" size={13} style={{ color: "#10140E" }} />}
      </span>
      <div className="min-w-0 flex-1" style={{ opacity: done ? 0.5 : 1 }}>
        <span className="text-[14.5px] text-text" style={{ textDecoration: done ? "line-through" : "none" }}>
          {group.descriptor && <span className="text-text-dim">{group.descriptor} </span>}
          {group.name}
        </span>
        {fromPantry && (
          <span className="ml-[6px] inline-flex items-center gap-[6px] align-middle">
            <span className="text-[10.5px] uppercase tracking-[0.06em] text-text-faint" style={{ fontFamily: "var(--font-mono)" }}>
              from pantry
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onUndoPantry(); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onUndoPantry(); } }}
              aria-label={`Move ${group.name} back to pantry`}
              className="cursor-pointer text-[10.5px] font-medium text-text-faint hover:text-text-dim"
            >
              undo
            </span>
          </span>
        )}
      </div>
      <div
        className="tnum shrink-0 pl-3 text-right text-[13.5px] text-text-dim"
        style={{ opacity: done ? 0.5 : 1, whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}
      >
        {group.items.map((ing, j) => {
          const unit = visibleUnit(ing.unit);
          return (
            <span key={j}>
              {j > 0 && <span className="text-text-faint"> + </span>}
              {formatQty(ing.quantity)}{unit ? ` ${unit}` : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Pantry check — items you already keep in stock, skipped from the
// buy list. "out — add it" splices the item onto the shopping list.
// ─────────────────────────────────────────────────────────────
function PantryCheck({
  pantry,
  outOfStock,
  onToggle,
}: {
  pantry: ShoppingGroup[];
  outOfStock: ReadonlySet<string>;
  onToggle: (group: ShoppingGroup) => void;
}) {
  return (
    <div>
      <div className="mb-[10px] flex items-center gap-[6px] text-[11px] font-semibold uppercase tracking-[0.14em] text-text-faint">
        <Icon name="pantry" size={13} />Pantry check · you should have these
      </div>
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-card)]">
        {pantry.map((g, i) => {
          const out = outOfStock.has(groupKey(g));
          return (
            <div
              key={groupKey(g)}
              className={["flex items-center gap-[10px] px-[14px] py-[10px]", i < pantry.length - 1 ? "border-b border-line" : ""].join(" ")}
            >
              <Icon name="check" size={15} style={{ color: "var(--sage)", flexShrink: 0 }} />
              <span className={["flex-1 text-[13.5px]", out ? "text-text" : "text-text-dim"].join(" ")}>
                {g.descriptor ? `${g.descriptor} ` : ""}{g.name}
              </span>
              <button
                type="button"
                onClick={() => onToggle(g)}
                aria-label={out ? `Remove ${g.name} from shopping list` : `Add ${g.name} to shopping list`}
                title={out ? undefined : "I'm actually out of this — add to shopping list"}
                className={[
                  "shrink-0 rounded-pill border px-[10px] py-[4px] text-[11px] font-medium transition-colors",
                  out
                    ? "border-accent-line bg-accent-tint text-accent-2"
                    : "border-line bg-transparent text-text-dim hover:border-line-2 hover:text-text",
                ].join(" ")}
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {out ? "added to list" : "out — add it"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Empty state — friendly basket + browse-the-library CTA.
// ─────────────────────────────────────────────────────────────
function EmptyState() {
  const cfg = useExperienceConfig();
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center lg:py-20">
      <div className="grid h-[88px] w-[88px] place-items-center rounded-full border border-line bg-surface">
        <Icon name="basket" size={38} style={{ color: "var(--text-faint)" }} />
      </div>
      <h2 className="mt-[18px] text-[22px] font-medium text-text lg:text-[24px]" style={{ fontFamily: "var(--font-serif)" }}>
        Your list is empty
      </h2>
      <p className="mt-2 max-w-[440px] text-[14px] leading-[1.55] text-text-dim lg:text-[15px]">
        Add dishes from the library or decide on a dinner — their ingredients roll up into one shopping list here, pantry items and all.
      </p>
      <Link
        href={`${cfg.hrefBase}/dishes`}
        className="mt-[22px] inline-flex items-center gap-2 rounded-pill bg-accent px-5 py-[13px] text-[15px] font-semibold text-accent-ink"
        style={{ fontFamily: "var(--font-sans)", letterSpacing: 0.2 }}
      >
        <Icon name="library" size={18} />Browse the library
      </Link>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Day group — a labelled cluster of planned dishes for one day (or
// the pool). Header shows the day name + count; cards carry servings
// steppers, a remove button, and the day picker.
// ─────────────────────────────────────────────────────────────
function DayGroup({
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
  const list = entries
    .map((e) => ({ entry: e, dish: byId.get(e.id) }))
    .filter((x): x is { entry: Entry; dish: Dish } => !!x.dish);

  // The pool always renders (so there's a drop target / hint); named days
  // only render when populated (the parent filters those out).
  if (list.length === 0 && activeDay !== null) return null;

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface p-[10px] shadow-[var(--shadow-card)]">
      <div className="flex items-baseline justify-between px-[2px] pb-[8px]">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-faint" title={sublabel}>
          {label}
        </span>
        {list.length > 0 && (
          <span className="tnum text-[11px] text-text-faint">{list.length}</span>
        )}
      </div>
      {list.length === 0 ? (
        <div className="py-3 text-center text-[12px] text-text-faint">
          Unassigned dishes land here.
        </div>
      ) : (
        <div className="flex flex-col gap-[8px]">
          {list.map(({ entry, dish }) => (
            <DishCard
              key={dish.id}
              dish={dish}
              entry={entry}
              onMove={onMove}
              onServings={onServings}
              onRemove={onRemove}
              activeDay={activeDay}
            />
          ))}
        </div>
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
  const cfg = useExperienceConfig();
  return (
    <div className="flex flex-col gap-[10px] rounded-[var(--radius-md)] border border-line bg-surface-2 p-[9px]">
      <div className="flex items-center gap-[11px]">
        <Link href={`${cfg.hrefBase}/dishes/${dish.id}`} aria-label={dish.title}>
          <DishArt dish={dish} size={44} corner="var(--radius-sm)" emojiSize={22} />
        </Link>
        <Link
          href={`${cfg.hrefBase}/dishes/${dish.id}`}
          className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-text hover:underline"
          style={{ fontFamily: "var(--font-serif)" }}
          title={dish.title}
        >
          {dish.title}
        </Link>
        <div className="flex shrink-0 items-center gap-[6px]">
          <button
            type="button"
            onClick={() => onServings(dish.id, -1)}
            aria-label="Fewer servings"
            className="grid h-[28px] w-[28px] place-items-center rounded-[var(--radius-sm)] border-0 bg-surface-3 text-text transition-colors hover:bg-line-2"
          >
            <Icon name="minus" size={13} />
          </button>
          <span className="tnum min-w-[16px] text-center text-[15px] font-medium text-text" style={{ fontFamily: "var(--font-serif)" }}>
            {entry.servings}
          </span>
          <button
            type="button"
            onClick={() => onServings(dish.id, 1)}
            aria-label="More servings"
            className="grid h-[28px] w-[28px] place-items-center rounded-[var(--radius-sm)] border-0 bg-surface-3 text-text transition-colors hover:bg-line-2"
          >
            <Icon name="plus" size={13} />
          </button>
          <button
            type="button"
            onClick={() => onRemove(dish.id)}
            aria-label="Remove from plan"
            className="grid h-[28px] w-[28px] place-items-center rounded-[var(--radius-sm)] text-text-faint transition-colors hover:text-rose"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
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
    "inline-flex h-[24px] min-w-[24px] items-center justify-center rounded-[var(--radius-sm)] text-[10.5px] font-semibold transition-colors";
  const inactive = "bg-bg text-text-faint hover:bg-surface-3 hover:text-text-dim";
  const active = "bg-accent text-accent-ink";
  return (
    <div className="flex flex-wrap gap-[3px]">
      <button
        type="button"
        onClick={() => onPick(null)}
        className={`${base} px-[8px] ${activeDay === null ? active : inactive}`}
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
          className={`${base} px-[6px] ${activeDay === i ? active : inactive}`}
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

function SpinnerGlyph() {
  return (
    <span
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        border: "2.5px solid rgba(42,20,10,0.3)",
        borderTopColor: "var(--accent-ink)",
        display: "inline-block",
        animation: "ds-spin .7s linear infinite",
      }}
    />
  );
}
