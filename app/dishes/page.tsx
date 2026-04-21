"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "../_components/app-header";
import { Chip, DishArt } from "../_components/ui";
import { Icon } from "../_components/icon";
import type { Dish } from "@/lib/types";
import {
  DIET_FILTERS,
  computeDietFlags,
  dishMatchesDietFilter,
  type DietFilter,
} from "@/lib/diet";

type Entry = { id: number; servings: number };

function relTime(iso: string | null): string {
  if (!iso) return "never cooked";
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 14) return `${Math.floor(d)}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export default function DishesPage() {
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [dietFilters, setDietFilters] = useState<DietFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeCount = selected.length + dietFilters.length + (favOnly ? 1 : 0);

  useEffect(() => {
    fetch("/api/dishes").then((r) => r.json()).then((data: Dish[]) => { setDishes(data); setLoading(false); }).catch(() => setLoading(false));
    fetch("/api/tags").then((r) => r.json()).then(setAllTags).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("mealPlan");
      if (raw) setEntries(JSON.parse(raw) as Entry[]);
    } catch { /* ignore */ }
  }, []);

  const writeEntries = (next: Entry[]) => {
    setEntries(next);
    try { localStorage.setItem("mealPlan", JSON.stringify(next)); } catch { /* ignore */ }
    fetch("/api/meal-plan", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries: next }),
    }).catch(() => {});
  };

  const togglePlan = (d: Dish, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const inPlan = entries.some((en) => en.id === d.id);
    writeEntries(inPlan ? entries.filter((en) => en.id !== d.id) : [...entries, { id: d.id, servings: d.baseServings }]);
  };

  const toggleFav = async (id: number, favorite: boolean) => {
    setDishes((ds) => ds.map((d) => (d.id === id ? { ...d, favorite } : d)));
    try {
      const res = await fetch(`/api/dishes/${id}/favorite`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ favorite }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setDishes((ds) => ds.map((d) => (d.id === id ? { ...d, favorite: !favorite } : d)));
    }
  };

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheetOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  const dietByDish = useMemo(() => {
    const map = new Map<number, ReturnType<typeof computeDietFlags>>();
    for (const d of dishes) map.set(d.id, computeDietFlags(d.ingredients));
    return map;
  }, [dishes]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return dishes.filter((d) => {
      if (favOnly && !d.favorite) return false;
      if (selected.length && !selected.every((t) => d.tags.includes(t))) return false;
      if (dietFilters.length) {
        const flags = dietByDish.get(d.id);
        if (!flags) return false;
        if (!dietFilters.every((f) => dishMatchesDietFilter(flags, f))) return false;
      }
      if (!query) return true;
      return `${d.title} ${d.subtitle ?? ""}`.toLowerCase().includes(query);
    });
  }, [dishes, q, favOnly, selected, dietFilters, dietByDish]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <AppHeader title="Dishes" subtitle={`${filtered.length} of ${dishes.length}`} />

      <div className="flex flex-col gap-2 border-b border-rule-soft bg-bg px-4 pt-3 pb-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Icon name="search" size={16} style={{ position: "absolute", left: 14, top: 12, color: "var(--ink-3)" }} />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              className="w-full rounded-pill border border-rule bg-paper px-10 py-[10px] text-[14px] text-ink placeholder:text-ink-3 focus:border-ink-3 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label="Filters"
            className="relative grid h-10 w-10 shrink-0 place-items-center rounded-pill border border-rule bg-paper text-ink-2 hover:border-ink-3"
          >
            <Icon name="filter" size={18} />
            {activeCount > 0 && (
              <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-pill bg-accent px-1 text-[10px] font-semibold text-accent-ink">
                {activeCount}
              </span>
            )}
          </button>
        </div>
        {activeCount > 0 && (
          <div className="flex flex-wrap gap-[6px]">
            {favOnly && (
              <button
                type="button"
                onClick={() => setFavOnly(false)}
                className="inline-flex items-center gap-[6px] rounded-pill border border-accent bg-accent px-3 py-[5px] text-[12px] font-medium text-accent-ink"
                style={{ letterSpacing: 0.2 }}
              >
                ★ Favourites <Icon name="x" size={11} />
              </button>
            )}
            {dietFilters.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setDietFilters((xs) => xs.filter((x) => x !== f))}
                className="inline-flex items-center gap-[6px] rounded-pill border border-accent bg-accent px-3 py-[5px] text-[12px] font-medium text-accent-ink"
                style={{ letterSpacing: 0.2 }}
              >
                {f} <Icon name="x" size={11} />
              </button>
            ))}
            {selected.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSelected((s) => s.filter((x) => x !== t))}
                className="inline-flex items-center gap-[6px] rounded-pill border border-accent bg-accent px-3 py-[5px] text-[12px] font-medium text-accent-ink"
                style={{ letterSpacing: 0.2 }}
              >
                {t} <Icon name="x" size={11} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto pb-20">
       <div className="mx-auto w-full max-w-6xl">
        {entries.length > 0 && (
          <div className="mx-4 mt-4 text-[12px] text-ink-3">
            {entries.length} in plan · <Link href="/plan" className="underline">view plan</Link>
          </div>
        )}
        <ul className="mx-4 my-4 grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((d) => {
            const inPlan = entries.some((en) => en.id === d.id);
            return (
              <li key={d.id} className="overflow-hidden rounded-lg border border-rule bg-paper">
                {/* Compact list layout on small screens */}
                <Link href={`/dishes/${d.id}`} className="flex gap-3 p-3 md:hidden">
                  <DishArt dish={d} size={72} corner="var(--radius-sm)" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <h3 className="m-0 truncate text-[17px] font-medium leading-tight tracking-[-0.01em] text-ink" style={{ fontFamily: "var(--font-disp)" }}>
                      {d.title}
                    </h3>
                    {d.subtitle && <div className="mt-[1px] truncate text-[12px] italic text-ink-3">{d.subtitle}</div>}
                    <div className="mt-auto flex flex-wrap items-center gap-x-[8px] gap-y-[2px] pt-2 text-[10px] uppercase tracking-[0.1em] text-ink-3">
                      {d.tags.slice(0, 3).map((t) => <span key={t}>· {t}</span>)}
                      {d.tags.length > 3 && <span>· +{d.tags.length - 3}</span>}
                      <span className="flex-1" />
                      <span className="normal-case" style={{ fontFamily: "var(--font-mono)" }}>
                        {relTime(d.lastCookedAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-center gap-[6px]">
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFav(d.id, !d.favorite); }}
                      aria-label={d.favorite ? "Remove favourite" : "Mark as favourite"}
                      className="grid h-8 w-8 place-items-center rounded-pill border border-rule bg-bg text-ink-2 hover:border-ink-3"
                    >
                      <Icon name={d.favorite ? "star-fill" : "star"} size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => togglePlan(d, e)}
                      aria-label={inPlan ? "In plan" : "Add to plan"}
                      className={[
                        "grid h-8 w-8 place-items-center rounded-pill border border-rule bg-bg hover:border-ink-3",
                        inPlan ? "text-good" : "text-accent",
                      ].join(" ")}
                    >
                      <Icon name={inPlan ? "check" : "plus"} size={14} />
                    </button>
                  </div>
                </Link>

                {/* Grid card on desktop / tablet */}
                <Link href={`/dishes/${d.id}`} className="hidden md:block">
                  <DishArt dish={d} size="100%" corner="0" className="!rounded-none" />
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="m-0 truncate text-[22px] font-medium leading-tight tracking-[-0.01em] text-ink" style={{ fontFamily: "var(--font-disp)" }}>
                          {d.title}
                        </h3>
                        {d.subtitle && <div className="mt-[2px] truncate text-[13px] italic text-ink-3">{d.subtitle}</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => togglePlan(d, e)}
                          className={[
                            "inline-flex items-center justify-center gap-2 rounded-pill font-medium transition-opacity",
                            "px-3 py-2 text-[12px] bg-transparent border border-rule hover:border-ink-3",
                            inPlan ? "text-good" : "text-accent",
                          ].join(" ")}
                          style={{ letterSpacing: 0.2 }}
                        >
                          {inPlan ? "✓ in plan" : "+ add to plan"}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFav(d.id, !d.favorite); }}
                          aria-label={d.favorite ? "Remove favourite" : "Mark as favourite"}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-pill border border-rule bg-bg text-ink-2 hover:border-ink-3"
                        >
                          <Icon name={d.favorite ? "star-fill" : "star"} size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-[10px] gap-y-[4px] text-[11px] uppercase tracking-[0.1em] text-ink-3">
                      {d.tags.map((t) => <span key={t}>· {t}</span>)}
                      <span className="flex-1" />
                      <span className="text-[11px] normal-case text-ink-3" style={{ fontFamily: "var(--font-mono)" }}>
                        last cooked {relTime(d.lastCookedAt)}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>

        {loading && <div className="mx-4 rounded-lg border border-dashed border-rule p-6 text-center text-ink-3">Loading dishes…</div>}
        {!loading && !dishes.length && <div className="mx-4 rounded-lg border border-dashed border-rule p-6 text-center text-ink-3">No dishes yet.</div>}
        {!loading && dishes.length > 0 && !filtered.length && <div className="mx-4 rounded-lg border border-dashed border-rule p-6 text-center text-ink-3">No dishes match the current filter.</div>}
       </div>
      </div>

      {sheetOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setSheetOpen(false)}
            aria-hidden
          />
          <div
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-[440px] flex-col overflow-hidden rounded-t-[20px] border border-rule bg-paper shadow-[0_-20px_60px_rgba(0,0,0,0.25)] md:max-w-2xl lg:max-w-3xl"
            style={{ animation: "sheetUp 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)", paddingBottom: "env(safe-area-inset-bottom)" }}
            role="dialog"
            aria-modal
          >
            <div className="flex items-center justify-between border-b border-rule-soft px-5 pt-4 pb-3">
              <h2 className="m-0 text-[20px] italic font-medium text-ink" style={{ fontFamily: "var(--font-disp)" }}>
                Filters
              </h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-pill border border-rule text-ink-2"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
            <div className="max-h-[52vh] overflow-auto px-5 pt-4 pb-4">
              <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                Diet
              </div>
              <div className="flex flex-wrap gap-[6px]">
                {DIET_FILTERS.map((f) => (
                  <Chip
                    key={f}
                    active={dietFilters.includes(f)}
                    onClick={() =>
                      setDietFilters((xs) =>
                        xs.includes(f) ? xs.filter((x) => x !== f) : [...xs, f],
                      )
                    }
                  >
                    {f}
                  </Chip>
                ))}
              </div>
              <div className="mt-4 mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                Tags
              </div>
              <div className="flex flex-wrap gap-[6px]">
                <Chip active={favOnly} onClick={() => setFavOnly((v) => !v)}>★ Favourites</Chip>
                {allTags.map((t) => (
                  <Chip
                    key={t}
                    active={selected.includes(t)}
                    onClick={() => setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))}
                  >
                    {t}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-rule-soft px-5 py-3">
              <button
                type="button"
                onClick={() => { setFavOnly(false); setSelected([]); setDietFilters([]); }}
                disabled={activeCount === 0}
                className="text-[13px] text-ink-2 underline underline-offset-4 disabled:no-underline disabled:opacity-40"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="rounded-pill bg-ink px-5 py-[10px] text-[13px] font-medium text-paper"
                style={{ letterSpacing: 0.2 }}
              >
                Show {filtered.length} {filtered.length === 1 ? "dish" : "dishes"}
              </button>
            </div>
          </div>
          <style>{`@keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
        </>
      )}
    </div>
  );
}
