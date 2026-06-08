"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Chip, DishArt, Stars } from "../_components/ui";
import { Icon, type IconName } from "../_components/icon";
import type { Dish } from "@/lib/types";
import {
  DIET_FILTERS,
  computeDietFlags,
  dishMatchesDietFilter,
  type DietFilter,
  type DietFlags,
} from "@/lib/diet";

type Entry = { id: number; servings: number };
type ViewMode = "grid" | "list";

function relTime(iso: string | null): string {
  if (!iso) return "never cooked";
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 14) return `${Math.floor(d)}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

// Short diet label derived from the computed flags (vegan wins over veg).
function dietLabel(flags: DietFlags): string | null {
  if (flags.vegan) return "Vegan";
  if (flags.vegetarian) return "Veg";
  return null;
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
  const [view, setView] = useState<ViewMode>("grid");

  const activeCount = selected.length + dietFilters.length + (favOnly ? 1 : 0);
  const clearAll = () => { setFavOnly(false); setSelected([]); setDietFilters([]); };

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
    const map = new Map<number, DietFlags>();
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

  const isInPlan = (d: Dish) => entries.some((en) => en.id === d.id);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-24 lg:pb-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col px-5 pt-[var(--safe-top)] lg:px-10">
          {/* Header section — no AppHeader; the shell owns the brand chrome. */}
          <div className="flex items-end justify-between gap-4 lg:mt-2">
            <div className="min-w-0">
              <div className="mb-[10px] text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
                Library
              </div>
              <h1
                className="m-0 font-medium leading-[1.04] tracking-[-0.02em] text-text"
                style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(30px,6vw,42px)" }}
              >
                Your collection
              </h1>
              <div className="mt-2 text-[13.5px] text-text-dim lg:text-[15px]">
                {filtered.length} of {dishes.length}
              </div>
            </div>
            <ViewToggle view={view} onChange={setView} />
          </div>

          {/* Mobile search + filter trigger (desktop uses the rail below). */}
          <div className="mt-4 flex items-center gap-[9px] lg:hidden">
            <SearchField q={q} onChange={setQ} />
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-label="Filters"
              className={[
                "relative grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[var(--radius-md)] border border-line transition-colors",
                activeCount ? "bg-accent-tint text-accent-2" : "bg-surface-2 text-text-dim",
              ].join(" ")}
            >
              <Icon name="list" size={19} />
              {activeCount > 0 && (
                <span className="absolute -top-[5px] -right-[5px] grid h-[18px] min-w-[18px] place-items-center rounded-pill bg-accent px-1 text-[10.5px] font-bold text-accent-ink">
                  {activeCount}
                </span>
              )}
            </button>
          </div>

          {/* Active-filter pill row (both breakpoints). */}
          {activeCount > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-[6px]">
              {favOnly && (
                <ActivePill onClear={() => setFavOnly(false)}>
                  <Icon name="heart" size={11} fill style={{ color: "var(--rose)" }} /> Favourites
                </ActivePill>
              )}
              {dietFilters.map((f) => (
                <ActivePill key={f} onClear={() => setDietFilters((xs) => xs.filter((x) => x !== f))}>
                  {f}
                </ActivePill>
              ))}
              {selected.map((t) => (
                <ActivePill key={t} onClear={() => setSelected((s) => s.filter((x) => x !== t))}>
                  {t}
                </ActivePill>
              ))}
              <button
                type="button"
                onClick={clearAll}
                className="px-1 text-[12.5px] font-semibold text-accent-2"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                Clear all
              </button>
            </div>
          )}

          {/* Plan hint */}
          {entries.length > 0 && (
            <div className="mt-3 text-[12px] text-text-faint">
              {entries.length} in plan · <Link href="/plan" className="underline underline-offset-2">view plan</Link>
            </div>
          )}

          {/* ---- Desktop: filter rail + results · Mobile: results only ---- */}
          <div className="mt-5 flex items-start gap-10 lg:mt-7">
            {/* Filter rail — desktop only (no sheet needed at lg). */}
            <aside className="hidden w-[224px] shrink-0 lg:block">
              <SearchField q={q} onChange={setQ} />

              <div className="mt-[26px]">
                <div className="mb-[11px] text-[11px] font-semibold uppercase tracking-[0.18em] text-text-faint">Show</div>
                <Chip active={favOnly} onClick={() => setFavOnly((v) => !v)}>
                  <Icon name="heart" size={13} fill={favOnly} style={{ marginRight: 5 }} />Favourites only
                </Chip>
              </div>

              <div className="mt-6">
                <div className="mb-[11px] text-[11px] font-semibold uppercase tracking-[0.18em] text-text-faint">Diet</div>
                <div className="flex flex-wrap gap-2">
                  {DIET_FILTERS.map((f) => (
                    <Chip
                      key={f}
                      active={dietFilters.includes(f)}
                      onClick={() => setDietFilters((xs) => (xs.includes(f) ? xs.filter((x) => x !== f) : [...xs, f]))}
                    >
                      {f}
                    </Chip>
                  ))}
                </div>
              </div>

              {allTags.length > 0 && (
                <div className="mt-6">
                  <div className="mb-[11px] text-[11px] font-semibold uppercase tracking-[0.18em] text-text-faint">Tags</div>
                  <div className="flex flex-wrap gap-2">
                    {allTags.map((t) => (
                      <Chip
                        key={t}
                        size="sm"
                        active={selected.includes(t)}
                        onClick={() => setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))}
                      >
                        {t}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-pill bg-surface-2 px-4 py-[10px] text-[13px] font-semibold text-text-dim transition-colors hover:bg-surface-3"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  <Icon name="close" size={15} />Clear {activeCount} filter{activeCount > 1 ? "s" : ""}
                </button>
              )}
            </aside>

            {/* Results */}
            <div className="min-w-0 flex-1">
              {loading ? (
                <div className="rounded-[var(--radius-lg)] border border-dashed border-line p-8 text-center text-[14px] text-text-dim">
                  Loading dishes…
                </div>
              ) : !dishes.length ? (
                <EmptyState
                  emoji="🍽️"
                  title="No dishes yet"
                  body="Add your first recipe and it’ll show up here."
                />
              ) : !filtered.length ? (
                <EmptyState
                  emoji="🔍"
                  title="No matches"
                  body="Nothing fits this search and filter set."
                />
              ) : view === "list" ? (
                <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-card)]">
                  {filtered.map((d) => (
                    <DishRow
                      key={d.id}
                      dish={d}
                      inPlan={isInPlan(d)}
                      flags={dietByDish.get(d.id)}
                      onFav={() => toggleFav(d.id, !d.favorite)}
                      onPlan={(e) => togglePlan(d, e)}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-[13px] lg:grid-cols-[repeat(auto-fill,minmax(212px,1fr))] lg:gap-[22px]">
                  {filtered.map((d) => (
                    <DishCard
                      key={d.id}
                      dish={d}
                      inPlan={isInPlan(d)}
                      flags={dietByDish.get(d.id)}
                      onFav={() => toggleFav(d.id, !d.favorite)}
                      onPlan={(e) => togglePlan(d, e)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile filter sheet */}
      {sheetOpen && (
        <FilterSheet
          allTags={allTags}
          favOnly={favOnly}
          setFavOnly={setFavOnly}
          dietFilters={dietFilters}
          setDietFilters={setDietFilters}
          selected={selected}
          setSelected={setSelected}
          activeCount={activeCount}
          resultCount={filtered.length}
          onClearAll={clearAll}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// View toggle — grid ⇄ list segmented control.
// ---------------------------------------------------------------
function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const opts: { id: ViewMode; label: string; icon: IconName }[] = [
    { id: "grid", label: "Grid", icon: "library" },
    { id: "list", label: "List", icon: "list" },
  ];
  return (
    <div className="inline-flex shrink-0 gap-[3px] rounded-[var(--radius-md)] border border-line bg-surface p-[3px]">
      {opts.map((o) => {
        const on = view === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={on}
            aria-label={o.label}
            className={[
              "flex items-center gap-[6px] whitespace-nowrap rounded-[var(--radius-sm)] px-[11px] py-[7px] text-[13px] font-semibold transition-colors lg:px-[13px]",
              on ? "bg-surface-3 text-text" : "bg-transparent text-text-dim hover:text-text",
            ].join(" ")}
            style={{ fontFamily: "var(--font-sans)" }}
          >
            <Icon name={o.icon} size={15} />
            <span className="hidden sm:inline">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------
// Search field — pill input with search icon + clear. Shared by the
// mobile bar and the desktop rail.
// ---------------------------------------------------------------
function SearchField({ q, onChange }: { q: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-1 items-center gap-[10px] rounded-[var(--radius-md)] border border-line bg-surface-2 px-[14px] py-[11px] transition-colors focus-within:border-accent-line">
      <Icon name="search" size={17} style={{ color: "var(--text-faint)" }} />
      <input
        type="search"
        value={q}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search dishes"
        className="min-w-0 flex-1 bg-transparent text-[14.5px] text-text placeholder:text-text-faint focus:outline-none"
        style={{ fontFamily: "var(--font-sans)" }}
      />
      {q && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="shrink-0 text-text-faint">
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Active-filter pill — accent-tinted, dismissible.
// ---------------------------------------------------------------
function ActivePill({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-[6px] rounded-pill border border-accent-line bg-accent-tint px-3 py-[5px] text-[12px] font-medium text-accent-2"
      style={{ letterSpacing: 0.2 }}
    >
      {children}
      <Icon name="close" size={11} />
    </button>
  );
}

// ---------------------------------------------------------------
// Dish card (grid) — V2 card: art hero with overlaid heart + meta.
// ---------------------------------------------------------------
function DishCard({
  dish,
  inPlan,
  flags,
  onFav,
  onPlan,
}: {
  dish: Dish;
  inPlan: boolean;
  flags: DietFlags | undefined;
  onFav: () => void;
  onPlan: (e: React.MouseEvent) => void;
}) {
  const avg = dish.averageRating;
  const diet = flags ? dietLabel(flags) : null;
  return (
    <Link
      href={`/dishes/${dish.id}`}
      className="group flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-card)] transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-[3px] hover:border-line-2 hover:shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_18px_44px_-14px_rgba(0,0,0,0.62)]"
    >
      <div className="relative">
        <div className="relative w-full overflow-hidden" style={{ aspectRatio: "1.2" }}>
          <DishArt dish={dish} fill emojiSize={64} />
        </div>
        {/* scrim for overlay legibility */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(180deg, rgba(15,11,8,0.34) 0%, transparent 26%, transparent 58%, rgba(15,11,8,0.62) 100%)" }}
        />
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onFav(); }}
          aria-label={dish.favorite ? "Remove favourite" : "Mark as favourite"}
          className={[
            "absolute right-[9px] top-[9px] grid h-[33px] w-[33px] place-items-center rounded-pill border-0 transition-[opacity,transform] duration-150",
            dish.favorite ? "opacity-100" : "opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100",
          ].join(" ")}
          style={{ background: "rgba(20,14,11,0.42)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
        >
          <Icon name="heart" size={16} fill={dish.favorite} style={{ color: dish.favorite ? "var(--rose)" : "#fff" }} />
        </button>
        {inPlan && (
          <div
            className="absolute left-[10px] top-[10px] rounded-pill bg-accent px-2 py-[3px] text-[10px] font-bold tracking-[0.04em] text-accent-ink"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            IN PLAN
          </div>
        )}
        {/* rating + diet on the photo */}
        <div className="absolute bottom-[10px] left-[10px] flex items-center gap-[6px]">
          {avg != null && (
            <span
              className="inline-flex items-center gap-[3.5px] rounded-pill px-[7px] py-[3px] text-[11.5px] font-semibold text-white"
              style={{ background: "rgba(20,14,11,0.5)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", fontFamily: "var(--font-sans)", fontVariantNumeric: "tabular-nums" }}
            >
              <Icon name="star" size={11} fill style={{ color: "var(--gold)" }} />
              {avg.toFixed(1)}
              {dish.ratingCount > 0 && <span className="text-white/70">({dish.ratingCount})</span>}
            </span>
          )}
          {diet && (
            <span
              className="rounded-pill px-2 py-[3px] text-[10px] font-bold tracking-[0.04em] text-sage"
              style={{ background: "rgba(20,14,11,0.5)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", fontFamily: "var(--font-sans)" }}
            >
              {diet.toUpperCase()}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-[11px_13px_13px]">
        <h3
          className="line-clamp-2 text-[16.5px] font-semibold leading-[1.16] tracking-[-0.01em] text-text"
          style={{ fontFamily: "var(--font-serif)", minHeight: "2.32em" }}
        >
          {dish.title}
        </h3>
        {dish.subtitle && (
          <div className="mt-[3px] line-clamp-1 text-[12px] italic text-text-dim">{dish.subtitle}</div>
        )}
        <div className="mt-[5px] flex items-center gap-[5px] whitespace-nowrap text-[11.5px] text-text-faint">
          <Icon name="clock" size={11.5} style={{ flexShrink: 0 }} />
          <span style={{ fontFamily: "var(--font-mono)" }}>{relTime(dish.lastCookedAt)}</span>
        </div>
        <div className="min-h-[11px] flex-1" />
        <button
          type="button"
          onClick={onPlan}
          className={[
            "mt-[11px] flex w-full items-center justify-center gap-[6px] rounded-[var(--radius-sm)] border px-[10px] py-[8px] text-[12.5px] font-semibold transition-colors",
            inPlan
              ? "border-accent-line bg-accent-tint text-accent-2"
              : "border-line-2 bg-transparent text-text-dim hover:border-accent-line hover:bg-accent-tint hover:text-accent-2",
          ].join(" ")}
          style={{ fontFamily: "var(--font-sans)" }}
        >
          <Icon name={inPlan ? "check" : "plus"} size={14} />
          {inPlan ? "In plan" : "Add to plan"}
        </button>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------
// Dish row (list) — dense row: thumb + title + meta + fav/add.
// ---------------------------------------------------------------
function DishRow({
  dish,
  inPlan,
  flags,
  onFav,
  onPlan,
}: {
  dish: Dish;
  inPlan: boolean;
  flags: DietFlags | undefined;
  onFav: () => void;
  onPlan: (e: React.MouseEvent) => void;
}) {
  const avg = dish.averageRating;
  const diet = flags ? dietLabel(flags) : null;
  return (
    <Link
      href={`/dishes/${dish.id}`}
      className="flex items-center gap-3 border-b border-line px-3 py-[11px] transition-colors last:border-b-0 hover:bg-surface-2 lg:gap-4 lg:px-4 lg:py-[13px]"
    >
      <DishArt dish={dish} size={48} corner="var(--radius-sm)" emojiSize={24} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[7px]">
          <span
            className="truncate text-[15px] font-semibold text-text lg:text-[16.5px]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {dish.title}
          </span>
          {dish.favorite && <Icon name="heart" size={12} fill style={{ color: "var(--rose)", flexShrink: 0 }} />}
        </div>
        {dish.subtitle ? (
          <div className="mt-[2px] truncate text-[12.5px] italic text-text-faint lg:text-[13px]">{dish.subtitle}</div>
        ) : null}
        {/* compact meta line (mobile-friendly); detailed columns appear at lg */}
        <div
          className="mt-[3px] flex items-center gap-[10px] text-[11.5px] text-text-faint lg:hidden"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          <span style={{ fontFamily: "var(--font-mono)" }}>{relTime(dish.lastCookedAt)}</span>
          {avg != null && <span style={{ color: "var(--gold)" }}>{avg.toFixed(1)}★</span>}
          {diet && <span style={{ color: "var(--sage)" }}>{diet}</span>}
        </div>
        {dish.tags.length > 0 && (
          <div className="mt-[3px] hidden flex-wrap items-center gap-x-[8px] text-[10px] uppercase tracking-[0.1em] text-text-faint lg:flex">
            {dish.tags.slice(0, 4).map((t) => <span key={t}>· {t}</span>)}
            {dish.tags.length > 4 && <span>· +{dish.tags.length - 4}</span>}
          </div>
        )}
      </div>

      {/* detailed columns — desktop only */}
      <div
        className="hidden shrink-0 items-center gap-4 text-[13px] text-text-dim lg:flex"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {avg != null ? <Stars value={avg} size={13} /> : null}
        <span className="w-[110px] text-right" style={{ fontFamily: "var(--font-mono)" }}>{relTime(dish.lastCookedAt)}</span>
        <span className="w-[44px] text-right" style={{ color: "var(--gold)" }}>{avg != null ? `${avg.toFixed(1)}★` : "—"}</span>
        <span className="w-[52px]" style={{ color: "var(--sage)" }}>{diet === "Vegan" ? "Vegan" : diet === "Veg" ? "Veg" : ""}</span>
      </div>

      <div className="flex shrink-0 items-center gap-[6px]">
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onFav(); }}
          aria-label={dish.favorite ? "Remove favourite" : "Mark as favourite"}
          className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] p-0 lg:h-[34px] lg:w-[34px]"
        >
          <Icon name="heart" size={16} fill={dish.favorite} style={{ color: dish.favorite ? "var(--rose)" : "var(--text-faint)" }} />
        </button>
        <button
          type="button"
          onClick={onPlan}
          aria-label={inPlan ? "In plan" : "Add to plan"}
          className={[
            "grid h-[30px] w-[30px] place-items-center rounded-[var(--radius-sm)] border transition-colors lg:h-[34px] lg:w-[34px]",
            inPlan ? "border-accent-line bg-accent-tint text-accent-2" : "border-line-2 bg-transparent text-text-dim hover:border-accent-line",
          ].join(" ")}
        >
          <Icon name={inPlan ? "check" : "plus"} size={15} />
        </button>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------
// Empty state — centered emoji + serif title + body.
// ---------------------------------------------------------------
function EmptyState({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <div className="px-6 py-12 text-center lg:py-16">
      <div className="text-[48px] opacity-40 lg:text-[52px]">{emoji}</div>
      <h3 className="mt-3 text-[19px] font-medium text-text lg:text-[22px]" style={{ fontFamily: "var(--font-serif)" }}>
        {title}
      </h3>
      <p className="mt-[6px] text-[13.5px] text-text-dim lg:text-[14.5px]">{body}</p>
    </div>
  );
}

// ---------------------------------------------------------------
// Mobile filter sheet — V2 bottom sheet with diet + tags + favourites.
// ---------------------------------------------------------------
function FilterSheet({
  allTags,
  favOnly,
  setFavOnly,
  dietFilters,
  setDietFilters,
  selected,
  setSelected,
  activeCount,
  resultCount,
  onClearAll,
  onClose,
}: {
  allTags: string[];
  favOnly: boolean;
  setFavOnly: React.Dispatch<React.SetStateAction<boolean>>;
  dietFilters: DietFilter[];
  setDietFilters: React.Dispatch<React.SetStateAction<DietFilter[]>>;
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  activeCount: number;
  resultCount: number;
  onClearAll: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/55" onClick={onClose} aria-hidden />
      <div
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88%] w-full flex-col overflow-hidden rounded-t-[20px] border border-line bg-surface shadow-[var(--shadow-pop)]"
        style={{ animation: "ds-rise .32s cubic-bezier(.2,.7,.2,1) both", paddingBottom: "max(34px, env(safe-area-inset-bottom))" }}
        role="dialog"
        aria-modal
      >
        <div className="flex justify-center pt-[10px] pb-1">
          <div className="h-1 w-[38px] rounded-pill bg-line-2" />
        </div>
        <div className="flex items-center justify-between px-[22px] pt-2 pb-1">
          <h2 className="m-0 text-[22px] font-medium text-text" style={{ fontFamily: "var(--font-serif)" }}>
            Filter
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-pill border border-line text-text-dim"
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="overflow-y-auto px-[22px] pt-1">
          <div className="mt-[18px] mb-[10px] text-[11px] font-semibold uppercase tracking-[0.18em] text-text-faint">Show</div>
          <Chip active={favOnly} onClick={() => setFavOnly((v) => !v)}>
            <Icon name="heart" size={13} fill={favOnly} style={{ marginRight: 5 }} />Favourites only
          </Chip>

          <div className="mt-5 mb-[10px] text-[11px] font-semibold uppercase tracking-[0.18em] text-text-faint">Diet</div>
          <div className="flex flex-wrap gap-2">
            {DIET_FILTERS.map((f) => (
              <Chip
                key={f}
                active={dietFilters.includes(f)}
                onClick={() => setDietFilters((xs) => (xs.includes(f) ? xs.filter((x) => x !== f) : [...xs, f]))}
              >
                {f}
              </Chip>
            ))}
          </div>

          <div className="mt-5 mb-[10px] text-[11px] font-semibold uppercase tracking-[0.18em] text-text-faint">
            Tags <span className="font-normal normal-case tracking-normal text-text-faint">· must match all</span>
          </div>
          <div className="flex flex-wrap gap-2 pb-2">
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

        <div className="mt-2 flex items-center gap-[10px] border-t border-line px-[22px] pt-[14px]">
          <button
            type="button"
            onClick={onClearAll}
            disabled={activeCount === 0}
            className="rounded-pill bg-surface-2 px-5 py-[12px] text-[14px] font-semibold text-text-dim disabled:opacity-40"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-pill bg-accent px-5 py-[12px] text-[14px] font-semibold text-accent-ink"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Show {resultCount}
          </button>
        </div>
      </div>
    </>
  );
}
