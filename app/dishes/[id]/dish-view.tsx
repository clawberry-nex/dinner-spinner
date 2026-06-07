"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DishArt, Button, ServingsStepper, useToast } from "@/app/_components/ui";
import { Icon } from "@/app/_components/icon";
import type { CookLogEntry, Dish, Ingredient, MethodRef } from "@/lib/types";
import { formatQty, scaleIngredient, visibleUnit } from "@/lib/ingredients";
import {
  groupIngredientsBySection,
  findNameSpans,
  findPhraseSpans,
  parseMethod,
} from "@/lib/recipe";
import { computeDietFlags, formatDietChips } from "@/lib/diet";
import { clearLastServings, readLastServings, writeLastServings } from "@/lib/last-servings";

function relTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return "Today";
  if (d < 2) return "Yesterday";
  if (d < 14) return `${Math.floor(d)}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
function fmtAvg(avg: number | null): string {
  if (avg == null) return "—";
  return (Math.round(avg * 10) / 10).toFixed(1);
}

export default function DishView({
  dish: initial,
  history: initialHistory,
  isOwner,
  ownerHandle,
  ownerName,
}: {
  dish: Dish;
  history: CookLogEntry[];
  isOwner: boolean;
  ownerHandle: string | null;
  ownerName: string | null;
}) {
  const router = useRouter();
  const [dish, setDish] = useState(initial);
  const [history, setHistory] = useState<CookLogEntry[]>(initialHistory);
  const [servings, setServings] = useState(initial.baseServings);
  // Hydrate from localStorage on mount so SSR/CSR agree on the first paint.
  useEffect(() => {
    const stored = readLastServings(initial.id);
    if (stored != null && stored !== initial.baseServings) setServings(stored);
  }, [initial.id, initial.baseServings]);
  useEffect(() => {
    writeLastServings(initial.id, servings);
  }, [initial.id, servings]);
  const setServingsClamped = useCallback((n: number) => setServings(Math.max(1, n)), []);
  const resetServings = useCallback(() => {
    setServings(initial.baseServings);
    clearLastServings(initial.id);
  }, [initial.baseServings, initial.id]);

  const [cookFormOpen, setCookFormOpen] = useState(false);
  const [inPlan, setInPlan] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return (JSON.parse(localStorage.getItem("mealPlan") || "[]") as { id: number }[]).some((e) => e.id === initial.id);
    } catch { return false; }
  });
  const toast = useToast();

  // — ingredient ⇄ method cross-highlighting (parity with cook mode) —
  // Both the mobile and desktop layouts render an ingredient list (CSS-toggled
  // via lg:), so each index can have up to two DOM nodes. We keep a Set per
  // index and scroll to whichever copy is currently visible.
  const [highlighted, setHighlighted] = useState<Set<number>>(new Set());
  const highlightToken = useRef(0);
  const ingredientRefs = useRef<Map<number, Set<HTMLElement>>>(new Map());

  const registerIngredientRef = useCallback((idx: number, el: HTMLElement | null) => {
    const map = ingredientRefs.current;
    if (el) {
      let set = map.get(idx);
      if (!set) { set = new Set(); map.set(idx, set); }
      set.add(el);
    } else {
      // ref cleanup: drop detached nodes for this index.
      const set = map.get(idx);
      if (set) for (const node of set) if (!node.isConnected) set.delete(node);
    }
  }, []);

  const flashIngredients = useCallback((idxs: number[], scroll: boolean) => {
    const valid = idxs.filter((i) => i >= 0 && i < dish.ingredients.length);
    if (valid.length === 0) return;
    if (scroll) {
      const set = ingredientRefs.current.get(valid[0]);
      // offsetParent is null for display:none nodes — pick the visible copy.
      const target = set && [...set].find((n) => n.offsetParent !== null);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const token = ++highlightToken.current;
    setHighlighted(new Set(valid));
    window.setTimeout(() => {
      if (highlightToken.current === token) setHighlighted(new Set());
    }, 1500);
  }, [dish.ingredients.length]);

  // For an ingredient line tap: flash itself (no scroll — it's already in view).
  const flashSelf = useCallback((idx: number) => flashIngredients([idx], false), [flashIngredients]);
  // For a method-step phrase tap: scroll to + flash the referenced ingredient.
  const flashFromMethod = useCallback((idxs: number[]) => flashIngredients(idxs, true), [flashIngredients]);

  const favorite = async () => {
    const next = !dish.favorite;
    setDish((d) => ({ ...d, favorite: next }));
    try {
      const res = await fetch(`/api/dishes/${dish.id}/favorite`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ favorite: next }),
      });
      if (!res.ok) throw new Error();
    } catch { setDish((d) => ({ ...d, favorite: !next })); }
  };

  const submitCook = async (rating: number | null, note: string | null) => {
    try {
      const res = await fetch("/api/cook-log", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ dishId: dish.id, rating, note }),
      });
      if (!res.ok) throw new Error();
      const saved = (await res.json()) as CookLogEntry;
      const entry: CookLogEntry = {
        id: saved.id, cookedAt: saved.cookedAt, rating: saved.rating, note: saved.note,
      };
      setHistory((h) => [entry, ...h]);
      // Recompute average client-side so the header summary matches.
      setDish((d) => {
        const rated = [entry, ...history].filter((e) => e.rating != null) as Array<CookLogEntry & { rating: number }>;
        const avg = rated.length ? rated.reduce((s, e) => s + e.rating, 0) / rated.length : null;
        return {
          ...d,
          lastCookedAt: entry.cookedAt,
          averageRating: avg,
          ratingCount: rated.length,
        };
      });
      setCookFormOpen(false);
      toast.show(rating != null ? `Logged · ${rating}★` : "Logged as cooked");
    } catch {
      toast.show("Couldn’t save cook log");
    }
  };

  const addToPlan = () => {
    try {
      const raw = localStorage.getItem("mealPlan");
      const list: { id: number; servings: number }[] = raw ? JSON.parse(raw) : [];
      const existing = list.find((e) => e.id === dish.id);
      const next = existing
        ? list.map((e) => (e.id === dish.id ? { ...e, servings } : e))
        : [...list, { id: dish.id, servings }];
      localStorage.setItem("mealPlan", JSON.stringify(next));
      fetch("/api/meal-plan", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries: next }) }).catch(() => {});
      setInPlan(true);
      toast.show(existing ? `Updated to ${servings} servings` : `Added at ${servings} servings`);
    } catch {}
  };

  const goCook = () => router.push(`/dishes/${dish.id}/cook?servings=${servings}`);
  const goEdit = () => router.push(`/dishes/${dish.id}/edit`);

  // Scaled ingredients shared by the ingredient list (both layouts).
  const scaledIngredients: Ingredient[] = useMemo(
    () => dish.ingredients.map((ing) => scaleIngredient(ing, servings, dish.baseServings)),
    [dish.ingredients, servings, dish.baseServings],
  );
  const ingredientGroups = useMemo(
    () => groupIngredientsBySection(scaledIngredients, (ing) => ing.section ?? null),
    [scaledIngredients],
  );

  const dietChips = useMemo(() => formatDietChips(computeDietFlags(dish.ingredients)), [dish.ingredients]);
  const servingsNote = servings === dish.baseServings ? `written for ${dish.baseServings}` : `scaled from ${dish.baseServings}`;
  const cooksLabel = dish.ratingCount > 0 ? `${dish.ratingCount} cook${dish.ratingCount > 1 ? "s" : ""}` : null;

  // Shared ingredient list (used by mobile column + desktop sticky panel).
  const ingredientList = (
    <IngredientList
      groups={ingredientGroups}
      highlighted={highlighted}
      onTapIngredient={isOwner ? flashSelf : undefined}
      registerRef={registerIngredientRef}
      empty={dish.ingredients.length === 0}
    />
  );

  const methodBlock = (
    <MethodBlock
      recipe={dish.recipe}
      ingredients={scaledIngredients}
      methodRefs={dish.methodRefs}
      onTapIngredients={flashFromMethod}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-24 lg:pb-12">
        <div className="mx-auto w-full max-w-[1080px]">
          {/* ── Hero — full-bleed art with gradient scrim + floating nav ── */}
          <div className="relative">
            {/* mobile hero (taller, ~1.25) */}
            <div className="relative w-full overflow-hidden lg:hidden" style={{ aspectRatio: "1.25" }}>
              <DishArt dish={dish} fill emojiSize={104} />
            </div>
            {/* desktop hero (cinematic banner, ~2.4) */}
            <div className="relative hidden w-full overflow-hidden lg:block" style={{ aspectRatio: "2.4" }}>
              <DishArt dish={dish} fill emojiSize={150} />
            </div>
            {/* scrim — top for nav legibility, bottom fades into the page bg */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: "linear-gradient(180deg, rgba(21,17,14,0.5) 0%, transparent 28%, transparent 55%, var(--bg) 100%)" }}
            />

            {/* back (always) */}
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Back"
              className="absolute left-[18px] top-[var(--safe-top)] z-[5] grid h-10 w-10 place-items-center rounded-pill border-0 lg:top-5"
              style={{ background: "rgba(20,14,11,0.5)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
            >
              <Icon name="back" size={20} style={{ color: "#fff" }} />
            </button>

            {/* owner controls: favorite + edit */}
            {isOwner && (
              <div className="absolute right-[18px] top-[var(--safe-top)] z-[5] flex items-center gap-[10px] lg:top-5">
                <button
                  type="button"
                  onClick={favorite}
                  aria-label={dish.favorite ? "Remove favourite" : "Mark as favourite"}
                  className="grid h-10 w-10 place-items-center rounded-pill border-0"
                  style={{ background: "rgba(20,14,11,0.5)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
                >
                  <Icon name="heart" size={19} fill={dish.favorite} style={{ color: dish.favorite ? "var(--rose)" : "#fff" }} />
                </button>
                <button
                  type="button"
                  onClick={goEdit}
                  aria-label="Edit recipe"
                  className="grid h-10 w-10 place-items-center rounded-pill border-0"
                  style={{ background: "rgba(20,14,11,0.5)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
                >
                  <Icon name="edit" size={18} style={{ color: "#fff" }} />
                </button>
              </div>
            )}

            {/* visitor credit, pinned bottom-left of the hero */}
            {!isOwner && (ownerHandle || ownerName) && (
              <div className="absolute bottom-[14px] left-[22px] z-[5] flex items-center gap-[7px] text-[12.5px] text-text-dim lg:left-[48px] lg:bottom-7">
                <span>shared by</span>
                {ownerHandle ? (
                  <Link href={`/u/${ownerHandle}`} className="font-semibold text-accent-2 hover:underline">
                    {ownerName?.trim() || `@${ownerHandle}`}
                  </Link>
                ) : (
                  <span className="font-semibold text-accent-2">{ownerName}</span>
                )}
              </div>
            )}

            {/* Desktop hero title overlay (sits in the bottom scrim). */}
            <div className="absolute inset-x-0 bottom-0 z-[4] hidden px-12 pb-7 lg:block">
              <div className="mx-auto max-w-[1080px]">
                <h1
                  className="m-0 font-medium leading-[1.02] tracking-[-0.02em] text-text"
                  style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(34px,3.4vw,50px)", textShadow: "0 2px 34px rgba(0,0,0,0.45)" }}
                >
                  {dish.title}
                </h1>
                {dish.subtitle && (
                  <div className="mt-[10px] max-w-[680px] text-[16.5px] leading-[1.45] text-text-dim">
                    {dish.subtitle}
                  </div>
                )}
                {isOwner && (
                  <div className="mt-[18px] flex flex-wrap items-center gap-[9px]">
                    {dish.averageRating != null && (
                      <HeroPill icon="star" iconColor="var(--gold)" fill>
                        {fmtAvg(dish.averageRating)}{cooksLabel ? ` · ${cooksLabel}` : ""}
                      </HeroPill>
                    )}
                    <HeroPill icon="clock">{relTime(dish.lastCookedAt)}</HeroPill>
                    <HeroPill icon="user2">{dish.baseServings} servings</HeroPill>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Mobile title block (desktop title lives in the hero) ── */}
          <div className="px-[22px] pt-[2px] lg:hidden" style={{ marginTop: -6 }}>
            <h1
              className="m-0 font-medium leading-[1.08] tracking-[-0.015em] text-text"
              style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(26px,7vw,32px)" }}
            >
              {dish.title}
            </h1>
            {dish.subtitle && <div className="mt-[6px] text-[14.5px] text-text-dim">{dish.subtitle}</div>}
            {dietChips.length > 0 && <DietChipRow chips={dietChips} className="mt-[13px]" />}
            {dish.tags.length > 0 && (
              <div className="mt-[10px] flex flex-wrap gap-[7px]">
                {dish.tags.map((t) => <TagChip key={t}>{t}</TagChip>)}
              </div>
            )}
          </div>

          {/* ── Desktop content well ── */}
          <div className="hidden px-12 pb-16 lg:block">
            <div className="mx-auto max-w-[1080px]">
              {/* chips row */}
              {(dietChips.length > 0 || dish.tags.length > 0) && (
                <div className="flex flex-wrap items-center gap-[10px]">
                  {dietChips.length > 0 && <DietChipRow chips={dietChips} />}
                  {dish.tags.map((t) => <TagChip key={t}>{t}</TagChip>)}
                </div>
              )}

              {/* action bar (owner) */}
              {isOwner && (
                <div className="mt-[22px] flex flex-wrap items-center justify-between gap-5 rounded-[var(--radius-lg)] border border-line bg-surface p-[16px_22px] shadow-[var(--shadow-card)]">
                  <div className="flex items-center gap-5">
                    <div>
                      <Eyebrow>Servings</Eyebrow>
                      <div className="mt-1 text-[12.5px] text-text-faint">{servingsNote}</div>
                    </div>
                    <ServingsStepper value={servings} base={dish.baseServings} onChange={setServingsClamped} onReset={resetServings} />
                  </div>
                  <div className="flex flex-wrap gap-[11px]">
                    <Button variant="ghost" onClick={() => setCookFormOpen(true)} className="px-4">
                      <Icon name="star" size={18} />Log a cook
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={addToPlan}
                      className={inPlan ? "border-accent-line bg-accent-tint text-accent-2" : ""}
                    >
                      <Icon name={inPlan ? "check" : "plus"} size={18} />{inPlan ? "In plan" : "Add to plan"}
                    </Button>
                    <Button variant="primary" onClick={goCook}>
                      <Icon name="flame" size={18} style={{ color: "var(--accent-ink)" }} />Cook now
                    </Button>
                  </div>
                </div>
              )}

              {/* two-column recipe */}
              <div
                className="mt-[38px] grid items-start gap-12"
                style={{ gridTemplateColumns: "minmax(300px, 360px) 1fr" }}
              >
                {/* ingredients — sticky panel */}
                <div className="sticky top-7">
                  <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-[20px_22px] shadow-[var(--shadow-card)]">
                    <div className="mb-[6px] flex items-baseline justify-between">
                      <Eyebrow accent>Ingredients</Eyebrow>
                      <span className="text-[12px] text-text-faint">
                        {servings === dish.baseServings ? `for ${dish.baseServings}` : `scaled to ${servings}`}
                      </span>
                    </div>
                    {/* Visitor desktop has no action bar → give it its own stepper. */}
                    {!isOwner && (
                      <div className="mb-3 flex items-center justify-between border-b border-line pb-3">
                        <span className="text-[12.5px] text-text-faint">{servingsNote}</span>
                        <ServingsStepper value={servings} base={dish.baseServings} onChange={setServingsClamped} onReset={resetServings} />
                      </div>
                    )}
                    {ingredientList}
                  </div>
                </div>

                {/* method */}
                <div>
                  <Eyebrow accent className="mb-[18px]">Method</Eyebrow>
                  {methodBlock}

                  {/* notes (owner) */}
                  {isOwner && dish.notes && <NotesCard notes={dish.notes} className="mt-2 max-w-[640px]" />}
                </div>
              </div>

              {/* stats + history (owner) */}
              {isOwner && (
                <div className="mt-11 border-t border-line pt-[30px]">
                  <div className="flex max-w-[560px] gap-[14px]">
                    <StatTile label="Last cooked" value={relTime(dish.lastCookedAt)} />
                    <StatTile
                      label="Avg rating"
                      value={dish.averageRating != null ? `${fmtAvg(dish.averageRating)}★` : "—"}
                      sub={cooksLabel ?? "no cooks logged"}
                    />
                    <StatTile label="Times cooked" value={history.length > 0 ? String(history.length) : "—"} />
                  </div>
                  {history.length > 0 && (
                    <div className="mt-6 max-w-[680px]">
                      <Eyebrow className="mb-3">History</Eyebrow>
                      {history.map((entry) => <HistoryRow key={entry.id} entry={entry} />)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Mobile content (single column) ── */}
          <div className="lg:hidden">
            {/* servings control */}
            <div className="mx-[22px] mt-[18px] flex items-center justify-between rounded-[var(--radius-lg)] border border-line bg-surface p-[15px_18px] shadow-[var(--shadow-card)]">
              <div>
                <Eyebrow>Servings</Eyebrow>
                <div className="mt-1 text-[12.5px] text-text-faint">{servingsNote}</div>
              </div>
              <ServingsStepper value={servings} base={dish.baseServings} onChange={setServingsClamped} onReset={resetServings} />
            </div>

            {/* primary actions (owner) — kept high & reachable */}
            {isOwner && (
              <div className="mt-[14px] flex gap-[10px] px-[22px]">
                <button
                  type="button"
                  onClick={() => setCookFormOpen(true)}
                  aria-label="Log a cook"
                  className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-pill border border-line-2 bg-transparent text-text"
                >
                  <Icon name="star" size={20} />
                </button>
                <button
                  type="button"
                  onClick={addToPlan}
                  className={[
                    "inline-flex h-[52px] shrink-0 items-center gap-[7px] rounded-pill border px-4 text-[15px] font-semibold transition-colors",
                    inPlan ? "border-accent-line bg-accent-tint text-accent-2" : "border-line-2 bg-transparent text-text",
                  ].join(" ")}
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  <Icon name={inPlan ? "check" : "plus"} size={18} />Plan
                </button>
                <Button variant="primary" onClick={goCook} className="h-[52px] flex-1 text-[15px]">
                  <Icon name="flame" size={18} style={{ color: "var(--accent-ink)" }} />Cook now
                </Button>
              </div>
            )}

            {/* ingredients */}
            <div className="px-[22px] pt-6">
              <Eyebrow accent className="mb-[6px]">Ingredients</Eyebrow>
              {ingredientList}
            </div>

            {/* method */}
            <div className="px-[22px] pt-[26px]">
              <Eyebrow accent className="mb-3">Method</Eyebrow>
              {methodBlock}
            </div>

            {/* owner footer: notes + stats + history */}
            {isOwner && (
              <div className="px-[22px] pt-2">
                {dish.notes && <NotesCard notes={dish.notes} className="mt-3" />}
                <div className="mt-[14px] flex gap-[12px]">
                  <StatTile label="Last cooked" value={relTime(dish.lastCookedAt)} />
                  <StatTile
                    label="Avg rating"
                    value={dish.averageRating != null ? `${fmtAvg(dish.averageRating)}★` : "—"}
                    sub={cooksLabel ?? ""}
                  />
                </div>
                {history.length > 0 && (
                  <div className="mt-[14px]">
                    <Eyebrow className="mb-[10px]">History</Eyebrow>
                    {history.map((entry) => <HistoryRow key={entry.id} entry={entry} />)}
                  </div>
                )}
              </div>
            )}

            {/* visitor footer: profile link */}
            {!isOwner && (ownerHandle || ownerName) && (
              <div className="px-[22px] pt-5 text-center">
                <div className="mx-auto mb-[18px] h-px max-w-[200px] bg-line" />
                <div className="text-[13px] text-text-faint">A recipe from</div>
                <div className="mt-1 text-[20px] font-medium text-accent-2" style={{ fontFamily: "var(--font-serif)" }}>
                  {ownerName?.trim() || (ownerHandle ? `@${ownerHandle}` : "a kitchen")}
                </div>
                {ownerHandle && (
                  <Link href={`/u/${ownerHandle}`} className="mt-[14px] inline-flex">
                    <Button variant="ghost">View profile<Icon name="arrowR" size={16} /></Button>
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {toast.el}
      {cookFormOpen && (
        <CookLogForm
          onCancel={() => setCookFormOpen(false)}
          onSubmit={submitCook}
        />
      )}
    </div>
  );
}

// ───────────────────────── shared atoms ─────────────────────────

function Eyebrow({ children, accent, className }: { children: React.ReactNode; accent?: boolean; className?: string }) {
  return (
    <div
      className={[
        "text-[11px] font-semibold uppercase tracking-[0.18em]",
        accent ? "text-accent" : "text-text-faint",
        className ?? "",
      ].join(" ")}
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {children}
    </div>
  );
}

function TagChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-pill bg-surface-2 px-[9px] py-[4px] text-[11.5px] font-medium text-text-dim"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {children}
    </span>
  );
}

function HeroPill({
  icon, iconColor, fill, children,
}: {
  icon: "star" | "clock" | "user2"; iconColor?: string; fill?: boolean; children: React.ReactNode;
}) {
  return (
    <span
      className="tnum inline-flex items-center gap-[6px] rounded-pill border px-3 py-[6px] text-[13px] font-semibold text-white"
      style={{ background: "rgba(18,12,9,0.5)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", borderColor: "rgba(255,255,255,0.14)" }}
    >
      <Icon name={icon} size={13} fill={fill} style={{ color: iconColor ?? "rgba(255,255,255,0.82)" }} />
      {children}
    </span>
  );
}

// ───────────────────── ingredients ─────────────────────

type IngGroup = ReturnType<typeof groupIngredientsBySection<Ingredient>>[number];

function IngredientList({
  groups,
  highlighted,
  onTapIngredient,
  registerRef,
  empty,
}: {
  groups: IngGroup[];
  highlighted: Set<number>;
  onTapIngredient?: (idx: number) => void;
  registerRef: (idx: number, el: HTMLElement | null) => void;
  empty: boolean;
}) {
  if (empty) {
    return <div className="py-[18px] text-[13.5px] italic text-text-faint">No ingredients listed yet.</div>;
  }
  return (
    <div>
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.title && (
            <div
              className="mb-[2px] text-[16px] font-semibold text-text"
              style={{ fontFamily: "var(--font-serif)", marginTop: gi ? 16 : 10 }}
            >
              {group.title}
            </div>
          )}
          <div className={group.title ? "" : "border-t border-line"}>
            {group.items.map(({ item: ing, index: i }, j) => (
              <div key={i}>
                <IngredientLine
                  ing={ing}
                  highlighted={highlighted.has(i)}
                  onTap={onTapIngredient ? () => onTapIngredient(i) : undefined}
                  registerRef={(el) => registerRef(i, el)}
                />
                {j < group.items.length - 1 && <div className="h-px bg-line" />}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function IngredientLine({
  ing,
  highlighted,
  onTap,
  registerRef,
}: {
  ing: Ingredient;
  highlighted: boolean;
  onTap?: () => void;
  registerRef: (el: HTMLElement | null) => void;
}) {
  const unit = visibleUnit(ing.unit);
  const qs = ing.quantity ? formatQty(ing.quantity) : "";
  const fixed = ing.scalable === false;
  return (
    <div
      ref={registerRef}
      onClick={onTap}
      role={onTap ? "button" : undefined}
      tabIndex={onTap ? 0 : undefined}
      onKeyDown={onTap ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } } : undefined}
      className={[
        "flex items-baseline gap-3 rounded-[var(--radius-sm)] px-1 py-[9px] transition-colors",
        onTap ? "cursor-pointer" : "",
        highlighted ? "bg-accent-tint" : "",
        ing.pantry ? "opacity-50" : "",
      ].join(" ")}
    >
      <div
        className="tnum min-w-[62px] shrink-0 text-[14.5px] font-semibold"
        style={{ color: fixed ? "var(--text-dim)" : "var(--text)" }}
      >
        {qs}{qs && unit ? " " : ""}{unit}
      </div>
      <div className="flex-1 text-[14.5px] leading-[1.4]">
        <span className="text-text">
          {ing.descriptor && <span className="text-text-dim">{ing.descriptor} </span>}
          {ing.name}
        </span>
        {ing.alternatives?.length ? (
          <span className="italic text-text-faint">, or {ing.alternatives.join(", ")}</span>
        ) : null}
        {ing.preparation && <span className="text-text-faint">, {ing.preparation}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-[5px]">
        {ing.pantry && <MiniTag>pantry</MiniTag>}
        {fixed && <MiniTag>fixed</MiniTag>}
        {ing.optional && <MiniTag>optional</MiniTag>}
      </div>
    </div>
  );
}

function MiniTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="self-center whitespace-nowrap rounded-[6px] bg-surface-2 px-[7px] py-[2px] text-[10px] font-semibold tracking-[0.03em] text-text-faint"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {children}
    </span>
  );
}

// ───────────────────── method ─────────────────────

// Linkify a method step: ingredient references (from methodRefs, else literal
// name match) become tappable spans that scroll to + flash the ingredient,
// mirroring cook mode. Pure presentational — no timer linkification here
// (that's a cook-mode concern).
function linkifyStep(
  text: string,
  ingredients: Ingredient[],
  methodRefs: MethodRef[] | null,
  onTap: (idxs: number[]) => void,
): React.ReactNode[] {
  const spans =
    methodRefs && methodRefs.length > 0
      ? findPhraseSpans(text, methodRefs)
      : findNameSpans(text, ingredients);
  if (spans.length === 0) return [text];

  const sorted = [...spans].sort((a, b) => (a.start !== b.start ? a.start - b.start : (b.end - b.start) - (a.end - a.start)));
  const picked: typeof sorted = [];
  let cursor = 0;
  for (const s of sorted) {
    if (s.start < cursor) continue;
    picked.push(s);
    cursor = s.end;
  }

  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const s of picked) {
    if (s.start > last) parts.push(text.slice(last, s.start));
    parts.push(
      <button
        key={`ing-${key++}`}
        type="button"
        onClick={(e) => { e.stopPropagation(); onTap(s.idxs); }}
        className="font-semibold text-accent-2 underline decoration-dotted decoration-accent-line underline-offset-2 hover:text-accent"
      >
        {text.slice(s.start, s.end)}
      </button>,
    );
    last = s.end;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function MethodBlock({
  recipe,
  ingredients,
  methodRefs,
  onTapIngredients,
}: {
  recipe: string | null;
  ingredients: Ingredient[];
  methodRefs: MethodRef[] | null;
  onTapIngredients: (idxs: number[]) => void;
}) {
  const sections = useMemo(() => (recipe ? parseMethod(recipe) : []), [recipe]);
  if (sections.length === 0) {
    return <div className="py-[18px] text-[13.5px] italic text-text-faint">No method written yet.</div>;
  }
  return (
    <>
      {sections.map((section, si) => (
        <div key={si} className="mb-[18px] lg:mb-[26px]">
          {section.title && (
            <div
              className="mb-[10px] text-[16px] font-semibold text-text lg:mb-[14px] lg:border-b lg:border-line lg:pb-2 lg:text-[19px]"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {section.title}
            </div>
          )}
          {section.steps.map((step, j) => (
            <div key={j} className="mb-[14px] flex gap-[13px] lg:mb-6 lg:gap-[18px]">
              {/* mobile: bare serif numeral · desktop: ringed token */}
              <div
                className="shrink-0 text-[18px] font-semibold leading-[1.3] text-accent lg:hidden"
                style={{ fontFamily: "var(--font-serif)", minWidth: 18 }}
              >
                {j + 1}
              </div>
              <div className="hidden h-8 w-8 shrink-0 place-items-center rounded-pill border border-accent-line bg-accent-tint lg:grid">
                <span className="text-[15px] font-bold text-accent-2" style={{ fontFamily: "var(--font-serif)" }}>{j + 1}</span>
              </div>
              <div className="text-[15px] leading-[1.5] text-text lg:max-w-[640px] lg:pt-1 lg:text-[16px] lg:leading-[1.7]">
                {linkifyStep(step, ingredients, methodRefs, onTapIngredients)}
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

// ───────────────────── notes / stats / history ─────────────────────

function NotesCard({ notes, className }: { notes: string; className?: string }) {
  return (
    <div
      className={["rounded-[var(--radius-sm)] border border-line bg-surface p-[14px_16px] shadow-[var(--shadow-card)]", className ?? ""].join(" ")}
      style={{ borderLeft: "2px solid var(--accent)" }}
      aria-label="Dish notes"
    >
      <Eyebrow className="mb-[6px] inline-flex items-center gap-[5px]">
        <Icon name="pin" size={12} style={{ verticalAlign: "-2px" }} />Notes
      </Eyebrow>
      <div className="text-[14px] italic leading-[1.5] text-text-dim" style={{ whiteSpace: "pre-wrap" }}>
        {notes}
      </div>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex-1 rounded-[var(--radius-lg)] border border-line bg-surface p-[13px_15px] shadow-[var(--shadow-card)]">
      <Eyebrow className="!text-[10px]">{label}</Eyebrow>
      <div className="mt-[5px] text-[21px] font-semibold text-text lg:text-[24px]" style={{ fontFamily: "var(--font-serif)" }}>
        {value}
      </div>
      {sub && <div className="mt-[2px] text-[11.5px] text-text-faint lg:text-[12px]">{sub}</div>}
    </div>
  );
}

function HistoryRow({ entry }: { entry: CookLogEntry }) {
  return (
    <div className="flex gap-[11px] border-b border-line py-[9px] lg:gap-[13px] lg:py-[11px]">
      <Icon name="clock" size={15} style={{ color: "var(--text-faint)", marginTop: 2 }} />
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <span className="text-[13.5px] text-text lg:text-[14.5px]">{relTime(entry.cookedAt)}</span>
          {entry.rating != null && <StarRow value={entry.rating} />}
        </div>
        {entry.note && (
          <div className="mt-[3px] text-[12.5px] italic text-text-faint lg:text-[13px]" style={{ whiteSpace: "pre-wrap" }}>
            “{entry.note}”
          </div>
        )}
      </div>
    </div>
  );
}

function StarRow({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-[2px]" aria-label={`${value} star${value === 1 ? "" : "s"}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon
          key={n}
          name="star"
          size={13}
          fill={n <= value}
          style={{ color: n <= value ? "var(--gold)" : "var(--surface-3)" }}
        />
      ))}
    </span>
  );
}

function DietChipRow({ chips, className }: { chips: ReturnType<typeof formatDietChips>; className?: string }) {
  if (!chips.length) return null;
  return (
    <div className={["flex flex-wrap gap-[6px]", className ?? ""].join(" ")} aria-label="Dietary info">
      {chips.map((c) => (
        <span
          key={c.label}
          className="inline-flex items-center gap-[5px] rounded-pill px-[10px] py-[4px] text-[12px] font-medium"
          style={{
            color: c.tone === "good" ? "var(--sage)" : "var(--rose)",
            background: c.tone === "good" ? "var(--sage-tint)" : "var(--rose-tint)",
          }}
        >
          {c.tone === "good" && <Icon name="leaf" size={13} />}
          {c.label === "vegan" ? "Vegan" : c.label === "vegetarian" ? "Vegetarian" : c.label.replace(/^contains /, "Contains ")}
        </span>
      ))}
    </div>
  );
}

// ───────────────────── cook-log form (bottom sheet / modal) ─────────────────────

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-[7px]" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => onChange(value === n ? 0 : n)}
            className="bg-none p-1"
          >
            <Icon name="star" size={32} fill={filled} style={{ color: filled ? "var(--gold)" : "var(--surface-3)" }} />
          </button>
        );
      })}
    </div>
  );
}

function CookLogForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (rating: number | null, note: string | null) => void | Promise<void>;
}) {
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const save = async () => {
    setBusy(true);
    try {
      await onSubmit(rating || null, note.trim() || null);
    } finally {
      setBusy(false);
    }
  };

  const today = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Log a cook"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div
        className="w-full max-w-[440px] border border-line bg-surface p-[26px_24px_30px] shadow-[var(--shadow-pop)] rounded-t-[20px] sm:rounded-[var(--radius-xl)]"
        style={{ animation: "ds-rise .3s cubic-bezier(.2,.7,.2,1) both" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <Eyebrow accent className="mb-2">Log a cook</Eyebrow>
            <h2 className="m-0 text-[24px] font-semibold leading-[1.1] text-text" style={{ fontFamily: "var(--font-serif)" }}>
              I cooked this
            </h2>
            <div className="mt-[6px] text-[13px] text-text-dim">
              Logged today, {today}. Append-only — no backdating.
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            disabled={busy}
            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-pill border-0 bg-surface-2 text-text-dim disabled:opacity-40"
          >
            <Icon name="close" size={17} />
          </button>
        </div>

        <Eyebrow className="mt-[22px] mb-[11px]">
          Rating <span className="font-normal normal-case tracking-normal text-text-faint">· optional</span>
        </Eyebrow>
        <StarPicker value={rating} onChange={setRating} />

        <label htmlFor="cook-note">
          <Eyebrow className="mt-[22px] mb-[11px]">
            Note <span className="font-normal normal-case tracking-normal text-text-faint">· optional</span>
          </Eyebrow>
        </label>
        <textarea
          id="cook-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="too salty — easy on the soy next time"
          rows={3}
          maxLength={2000}
          className="w-full resize-none rounded-[10px] border border-line bg-surface-2 px-[14px] py-3 text-[14.5px] text-text placeholder:text-text-faint focus:border-accent-line focus:outline-none"
          style={{ fontFamily: "var(--font-sans)" }}
        />

        <Button variant="primary" onClick={save} disabled={busy} className="mt-5 w-full">
          <Icon name="check" size={18} style={{ color: "var(--accent-ink)" }} />{busy ? "Saving…" : "Save to history"}
        </Button>
      </div>
    </div>
  );
}
