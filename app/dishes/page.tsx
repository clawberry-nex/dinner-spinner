"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "../_components/app-header";
import { Chip, DishArt } from "../_components/ui";
import { Icon } from "../_components/icon";
import type { Dish } from "@/lib/types";

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
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<Entry[]>([]);

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

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return dishes.filter((d) => {
      if (favOnly && !d.favorite) return false;
      if (selected.length && !selected.every((t) => d.tags.includes(t))) return false;
      if (!query) return true;
      return `${d.title} ${d.subtitle ?? ""}`.toLowerCase().includes(query);
    });
  }, [dishes, q, favOnly, selected]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <AppHeader title="Dishes" subtitle={`${filtered.length} of ${dishes.length}`} />

      <div className="flex flex-col gap-3 border-b border-rule-soft bg-bg px-4 pt-3 pb-4">
        <div className="relative">
          <Icon name="search" size={16} style={{ position: "absolute", left: 14, top: 12, color: "var(--ink-3)" }} />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="w-full rounded-pill border border-rule bg-paper px-10 py-[10px] text-[14px] text-ink placeholder:text-ink-3 focus:border-ink-3 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-[6px]">
          <Chip active={favOnly} onClick={() => setFavOnly((v) => !v)}>★ Favourites</Chip>
          {allTags.map((t) => (
            <Chip key={t} active={selected.includes(t)} onClick={() => setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))}>
              {t}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto pb-20">
        {entries.length > 0 && (
          <div className="mx-4 mt-4 text-[12px] text-ink-3">
            {entries.length} in plan · <Link href="/plan" className="underline">view plan</Link>
          </div>
        )}
        <ul className="mx-4 my-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {filtered.map((d) => (
            <li key={d.id} className="overflow-hidden rounded-lg border border-rule bg-paper">
              <Link href={`/dishes/${d.id}`} className="block">
                <DishArt dish={d} size="100%" corner="0" className="!rounded-none" />
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <h3 className="m-0 text-[22px] font-medium leading-tight tracking-[-0.01em] text-ink" style={{ fontFamily: "var(--font-disp)" }}>
                        {d.title}
                      </h3>
                      {d.subtitle && <div className="mt-[2px] text-[13px] italic text-ink-3">{d.subtitle}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => togglePlan(d, e)}
                        className={[
                          "inline-flex items-center justify-center gap-2 rounded-pill font-medium transition-opacity",
                          "px-3 py-2 text-[12px] bg-transparent border border-rule hover:border-ink-3",
                          entries.some((en) => en.id === d.id) ? "text-good" : "text-accent",
                        ].join(" ")}
                        style={{ letterSpacing: 0.2 }}
                      >
                        {entries.some((en) => en.id === d.id) ? "✓ in plan" : "+ add to plan"}
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
          ))}
        </ul>

        {loading && <div className="mx-4 rounded-lg border border-dashed border-rule p-6 text-center text-ink-3">Loading dishes…</div>}
        {!loading && !dishes.length && <div className="mx-4 rounded-lg border border-dashed border-rule p-6 text-center text-ink-3">No dishes yet.</div>}
        {!loading && dishes.length > 0 && !filtered.length && <div className="mx-4 rounded-lg border border-dashed border-rule p-6 text-center text-ink-3">No dishes match the current filter.</div>}
      </div>
    </div>
  );
}
