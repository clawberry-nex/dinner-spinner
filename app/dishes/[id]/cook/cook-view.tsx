"use client";
/* eslint-disable react-hooks/refs */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dish, Ingredient } from "@/lib/types";
import { Icon } from "@/app/_components/icon";
import { formatQty, scaleIngredient, visibleUnit } from "@/lib/ingredients";
import {
  parseMethod,
  groupIngredientsBySection,
  findNameSpans,
} from "@/lib/recipe";
import { parseInlineRefs } from "@/lib/inline-refs";
import { findTimers } from "@/lib/timer-parse";
import { useTimers } from "./use-timers";
import TimerPanel from "./timer-panel";

type Span =
  | { kind: "ingredient"; start: number; end: number; idxs: number[] }
  | { kind: "timer"; start: number; end: number; seconds: number; label: string };

// One flattened step: its text plus the section heading it belongs to (shown as
// an eyebrow above the big step text). parseMethod groups by section; cook mode
// walks the steps linearly while remembering which section each came from.
type FlatStep = { section: string | null; text: string };

function flattenSteps(recipe: string | null): FlatStep[] {
  if (!recipe) return [];
  const out: FlatStep[] = [];
  for (const section of parseMethod(recipe)) {
    for (const text of section.steps) out.push({ section: section.title, text });
  }
  return out;
}

// Linkify a step. Ingredient references come from inline `[label](#id)` markers
// in the Method text (parseInlineRefs → ids resolved to ingredient indices);
// a step with no markers falls back to literal name matching. Duration patterns
// ("15 min") become tappable timers. The raw step text is collapsed to display
// text first, so every offset below indexes what the reader actually sees.
// Overlaps resolve earliest-start-wins; equal starts favor the longer span.
function linkifyStep(
  rawText: string,
  ingredients: Ingredient[],
  onTapIngredients: (idxs: number[]) => void,
  onStartTimer: (label: string, seconds: number) => void,
): React.ReactNode[] {
  const { text, refs } = parseInlineRefs(rawText);
  const idToIndex = new Map<string, number>();
  ingredients.forEach((ing, i) => {
    if (ing.id) idToIndex.set(ing.id, i);
  });
  const ingRaw =
    refs.length > 0
      ? refs
          .map((r) => ({
            start: r.start,
            end: r.end,
            idxs: r.ids
              .map((id) => idToIndex.get(id))
              .filter((i): i is number => i !== undefined),
          }))
          .filter((s) => s.idxs.length > 0)
      : findNameSpans(text, ingredients);
  const ingredientSpans: Span[] = ingRaw.map((s) => ({
    kind: "ingredient",
    start: s.start,
    end: s.end,
    idxs: s.idxs,
  }));
  const timerSpans: Span[] = findTimers(text).map((t) => ({
    kind: "timer",
    start: t.start,
    end: t.end,
    seconds: t.seconds,
    label: t.label,
  }));

  const all = [...ingredientSpans, ...timerSpans].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - b.start - (a.end - a.start);
  });

  const picked: Span[] = [];
  let cursor = 0;
  for (const s of all) {
    if (s.start < cursor) continue;
    picked.push(s);
    cursor = s.end;
  }

  if (picked.length === 0) return [text];

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const s of picked) {
    if (s.start > lastIndex) parts.push(text.slice(lastIndex, s.start));
    const matched = text.slice(s.start, s.end);
    if (s.kind === "ingredient") {
      parts.push(
        <button
          key={`ing-${key++}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTapIngredients(s.idxs);
          }}
          className="font-semibold text-accent-2 underline decoration-dotted decoration-accent-line underline-offset-[3px] hover:text-accent"
        >
          {matched}
        </button>,
      );
    } else {
      parts.push(
        <button
          key={`tmr-${key++}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStartTimer(s.label, s.seconds);
          }}
          title={`Start ${s.label} timer`}
          className="mx-[2px] inline-flex items-center gap-[5px] rounded-[var(--radius-sm)] border border-accent-line bg-accent-tint px-[9px] py-[1px] align-middle font-semibold text-accent-2 hover:bg-surface-3"
          style={{ fontSize: "0.62em", fontFamily: "var(--font-sans)", whiteSpace: "nowrap" }}
        >
          <Icon name="timer" size={14} />
          {matched.trim()}
        </button>,
      );
    }
    lastIndex = s.end;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function useWakeLock() {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const hasApi = typeof navigator !== "undefined" && "wakeLock" in navigator;
    // One-time synchronous check on mount — not a cascading render concern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(hasApi);
    if (!hasApi) return;

    let cancelled = false;

    async function acquire() {
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
        setActive(true);
        sentinel.addEventListener("release", () => {
          setActive(false);
          sentinelRef.current = null;
        });
      } catch (err) {
        console.warn("Screen wake lock request failed", err);
      }
    }

    acquire();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !sentinelRef.current) {
        acquire();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      sentinelRef.current?.release().catch(() => {});
      sentinelRef.current = null;
    };
  }, []);

  return { supported, active };
}

export default function CookView({
  dish,
  initialServings,
}: {
  dish: Dish;
  initialServings: number;
}) {
  const router = useRouter();
  const [servings, setServings] = useState<number>(initialServings);
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1); // +1 → next (slide in from right), -1 → prev
  const [ingOpen, setIngOpen] = useState(true);
  const [highlighted, setHighlighted] = useState<Set<number>>(new Set());
  const highlightToken = useRef(0);
  // Each ingredient index can have up to two DOM nodes (mobile panel + desktop
  // rail, CSS-toggled via lg:); scroll whichever copy is currently visible.
  const ingredientRefs = useRef<Map<number, Set<HTMLElement>>>(new Map());
  const ingScrollRef = useRef<HTMLDivElement | null>(null);
  const railScrollRef = useRef<HTMLDivElement | null>(null);
  const wakeLock = useWakeLock();
  const timers = useTimers();

  const steps = useMemo(() => flattenSteps(dish.recipe), [dish.recipe]);
  const total = steps.length;
  const atStart = idx <= 0;
  const atEnd = idx >= total - 1;

  // Clamp the cursor if the step list ever shrinks.
  const safeIdx = total === 0 ? 0 : Math.min(idx, total - 1);
  const step = steps[safeIdx];

  const scaledIngredients: Ingredient[] = useMemo(
    () =>
      dish.ingredients.map((ing) =>
        scaleIngredient(ing, servings, dish.baseServings),
      ),
    [dish.ingredients, servings, dish.baseServings],
  );

  const ingredientGroups = useMemo(
    () =>
      groupIngredientsBySection(scaledIngredients, (ing) => ing.section ?? null),
    [scaledIngredients],
  );

  const goPrev = useCallback(() => {
    setDir(-1);
    setIdx((i) => Math.max(0, i - 1));
  }, []);
  const goNext = useCallback(() => {
    setDir(1);
    setIdx((i) => Math.min(total - 1, i + 1));
  }, [total]);
  const goTo = useCallback(
    (i: number) => {
      setDir(i >= idx ? 1 : -1);
      setIdx(i);
    },
    [idx],
  );
  const exit = useCallback(
    () => router.push(`/dishes/${dish.id}`),
    [router, dish.id],
  );

  // Keyboard: ←/→ move between steps, Esc exits (matches the desktop prototype).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "Escape") {
        exit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, exit]);

  const registerIngredientRef = useCallback((idx: number, el: HTMLElement | null) => {
    const map = ingredientRefs.current;
    if (el) {
      let set = map.get(idx);
      if (!set) {
        set = new Set();
        map.set(idx, set);
      }
      set.add(el);
    } else {
      const set = map.get(idx);
      if (set) for (const node of set) if (!node.isConnected) set.delete(node);
    }
  }, []);

  // Tap an ingredient name in the step → open the panel, scroll the visible copy
  // into view (centered within its own scroller), and flash it.
  const scrollToIngredients = useCallback((idxs: number[]) => {
    const valid = idxs.filter(
      (i) => i >= 0 && i < dish.ingredients.length,
    );
    if (valid.length === 0) return;
    setIngOpen(true);
    const set = ingredientRefs.current.get(valid[0]);
    // offsetParent is null for display:none nodes — pick the visible copy.
    const target = set && [...set].find((n) => n.offsetParent !== null);
    if (target) {
      const scroller =
        target.closest("[data-ing-scroll]") instanceof HTMLElement
          ? (target.closest("[data-ing-scroll]") as HTMLElement)
          : null;
      if (scroller) {
        // Measure relative to the scroller's own box, not via offsetTop:
        // offsetTop is relative to the nearest positioned ancestor (the root
        // .relative container far above this panel), so it overshoots and the
        // scroll clamps to the bottom instead of centering the ingredient.
        const targetRect = target.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        const top =
          scroller.scrollTop +
          (targetRect.top - scrollerRect.top) -
          scroller.clientHeight / 2 +
          targetRect.height / 2;
        scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      } else {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    const token = ++highlightToken.current;
    setHighlighted(new Set(valid));
    window.setTimeout(() => {
      if (highlightToken.current === token) setHighlighted(new Set());
    }, 4000);
  }, [dish.ingredients.length]);

  // — tactile drag-to-swipe between steps (mobile), transform-only —
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const moved = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    // Ignore drags that begin on an interactive token (ingredient/timer button).
    if ((e.target as HTMLElement).closest("button")) return;
    startX.current = e.clientX;
    moved.current = false;
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture can throw for unsupported pointer ids.
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    let dx = e.clientX - startX.current;
    if (Math.abs(dx) > 4) moved.current = true;
    if ((atStart && dx > 0) || (atEnd && dx < 0)) dx *= 0.32; // rubber-band at ends
    setDragX(dx);
  };
  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    const dx = dragX;
    setDragX(0);
    if (dx < -64) goNext();
    else if (dx > 64) goPrev();
  };

  const servingsLabel = `${servings} serving${servings > 1 ? "s" : ""}`;

  // Shared ingredient rows (rendered into both the mobile panel and desktop rail
  // with their own scroll container; refs keyed by index for cross-highlighting).
  const ingredientRows = (
    <IngredientRows
      groups={ingredientGroups}
      highlighted={highlighted}
      registerRef={registerIngredientRef}
      empty={dish.ingredients.length === 0}
    />
  );

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col bg-bg-deep">
      {/* ── top bar ── */}
      <div className="flex items-center justify-between gap-[10px] px-4 pt-[var(--safe-top)] pb-3 lg:px-7 lg:pt-5">
        <button
          type="button"
          onClick={exit}
          aria-label="Exit cooking"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-line bg-surface text-text transition-colors hover:bg-surface-2 lg:w-auto lg:gap-2 lg:px-[14px]"
        >
          <Icon name="close" size={19} />
          <span className="hidden text-[13px] font-medium lg:inline" style={{ fontFamily: "var(--font-sans)" }}>
            Exit
          </span>
        </button>

        {/* center identity (mobile) / left-aligned (desktop) */}
        <div className="flex min-w-0 flex-1 items-center justify-center gap-[10px] lg:justify-start lg:gap-[13px]">
          <DishThumb dish={dish} />
          <div className="min-w-0">
            <div className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-accent lg:text-[10px]" style={{ fontFamily: "var(--font-sans)" }}>
              Now cooking
            </div>
            <div
              className="truncate font-semibold leading-[1.15] text-text"
              style={{ fontFamily: "var(--font-serif)", fontSize: "var(--cook-title, 14.5px)", maxWidth: 360 }}
            >
              {dish.title}
            </div>
          </div>
        </div>

        {/* right: step counter (always) + ingredients toggle (mobile only) */}
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center gap-[7px] text-[12.5px] text-text-faint lg:flex">
            <span className="inline-block h-[6px] w-[6px] rounded-pill" style={{ background: wakeLock.active ? "var(--sage)" : "var(--surface-3)" }} />
            {wakeLock.supported === false ? "Screen may sleep" : wakeLock.active ? "Screen staying awake" : "…"}
          </div>
          {total > 0 && (
            <span className="tnum hidden text-[13px] font-semibold text-text-dim lg:inline" style={{ fontFamily: "var(--font-sans)" }}>
              Step {safeIdx + 1} / {total}
            </span>
          )}
          <button
            type="button"
            onClick={() => setIngOpen((o) => !o)}
            aria-label={ingOpen ? "Hide ingredients" : "Show ingredients"}
            aria-pressed={ingOpen}
            className={[
              "grid h-10 w-10 place-items-center rounded-[var(--radius-md)] border transition-colors lg:hidden",
              ingOpen ? "border-accent-line bg-accent-tint text-accent-2" : "border-line bg-surface text-text",
            ].join(" ")}
          >
            <Icon name="list" size={18} />
          </button>
        </div>
      </div>

      {/* ── progress dots (one per step) ── */}
      {total > 0 && (
        <div className="px-[18px] pt-[2px] lg:px-7">
          <div className="flex gap-[4px]">
            {steps.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Go to step ${i + 1}`}
                aria-current={i === safeIdx ? "step" : undefined}
                className="h-[5px] flex-1 rounded-pill border-0 p-0 transition-colors lg:h-[6px]"
                style={{
                  background:
                    i === safeIdx
                      ? "var(--accent)"
                      : i < safeIdx
                        ? "var(--accent-deep)"
                        : "var(--surface-3)",
                }}
              />
            ))}
          </div>
          {/* mobile-only sub-line: wake-lock status + counter */}
          <div className="mt-[9px] flex items-center justify-between lg:hidden">
            <span className="flex items-center gap-[6px] text-[11.5px] text-text-faint">
              <span className="inline-block h-[5px] w-[5px] rounded-pill" style={{ background: wakeLock.active ? "var(--sage)" : "var(--surface-3)" }} />
              {wakeLock.supported === false ? "Screen may sleep" : wakeLock.active ? "Screen staying awake" : "…"}
            </span>
            {total > 0 && (
              <span className="tnum text-[11.5px] text-text-faint">
                Step {safeIdx + 1} of {total}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── body: step stage (+ desktop ingredient rail) ── */}
      <div className="flex min-h-0 flex-1 lg:gap-0">
        {/* step stage */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto overflow-x-hidden px-[26px] py-6 lg:px-12"
            style={{ touchAction: "pan-y", cursor: dragging ? "grabbing" : undefined }}
          >
            {total === 0 ? (
              <p className="text-[14px] italic text-text-faint">No method written yet.</p>
            ) : (
              <div className="mx-auto w-full lg:max-w-[760px]">
                <div
                  key={safeIdx}
                  style={{
                    transform: `translateX(${dragX}px)`,
                    transition: dragging ? "none" : "transform .3s cubic-bezier(.2,.7,.2,1)",
                    animation: `${dir > 0 ? "ds-stepin-r" : "ds-stepin-l"} .34s cubic-bezier(.2,.7,.2,1)`,
                  }}
                >
                  {/* desktop: ringed step numeral + section eyebrow */}
                  <div className="mb-[18px] hidden items-center gap-4 lg:flex">
                    <span
                      className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-pill border-[1.5px] border-accent-line text-accent"
                      style={{ fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 600 }}
                    >
                      {safeIdx + 1}
                    </span>
                    {step?.section && (
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent" style={{ fontFamily: "var(--font-sans)" }}>
                        {step.section}
                      </div>
                    )}
                  </div>
                  {/* mobile: section eyebrow only (numeral lives in the counter) */}
                  {step?.section && (
                    <div className="mb-[14px] text-[10.5px] font-semibold uppercase tracking-[0.18em] text-accent lg:hidden" style={{ fontFamily: "var(--font-sans)" }}>
                      {step.section}
                    </div>
                  )}
                  <p
                    className="m-0 text-text"
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontWeight: 400,
                      letterSpacing: "-0.01em",
                      lineHeight: 1.4,
                      fontSize: "clamp(27px, 4.4vw, 40px)",
                    }}
                  >
                    {step
                      ? linkifyStep(step.text, scaledIngredients, scrollToIngredients, timers.start)
                      : null}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* nav footer */}
          {total > 0 && (
            <div className="shrink-0 border-t border-line bg-surface px-[18px] py-[14px] lg:px-12 lg:py-5">
              {/* desktop: Prev / kbd hint / Next-or-Finish */}
              <div className="mx-auto hidden max-w-[760px] items-center justify-between lg:flex">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={atStart}
                  className="inline-flex items-center gap-2 rounded-pill border border-line bg-transparent px-[18px] py-[10px] text-[14px] font-medium text-text transition-colors hover:border-line-2 disabled:opacity-40"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  <Icon name="chevL" size={18} />
                  Previous
                </button>
                <div className="flex items-center gap-2 text-[12.5px] text-text-faint">
                  <Kbd>←</Kbd>
                  <Kbd>→</Kbd>
                  <span>to move</span>
                </div>
                {atEnd ? (
                  <button
                    type="button"
                    onClick={exit}
                    className="inline-flex items-center gap-2 rounded-pill border border-accent bg-accent px-[22px] py-[10px] text-[14px] font-medium text-accent-ink"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    <Icon name="check" size={18} style={{ color: "var(--accent-ink)" }} />
                    Finish cooking
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={goNext}
                    className="inline-flex items-center gap-2 rounded-pill border border-accent bg-accent px-[22px] py-[10px] text-[14px] font-medium text-accent-ink"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    Next step
                    <Icon name="chevR" size={18} style={{ color: "var(--accent-ink)" }} />
                  </button>
                )}
              </div>

              {/* mobile: Prev | hint | Next-or-Finish */}
              <div className="flex items-center gap-[10px] lg:hidden">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={atStart}
                  aria-label="Previous step"
                  className="grid h-[50px] w-[50px] shrink-0 place-items-center rounded-pill border border-line bg-transparent text-text transition-colors disabled:opacity-35"
                >
                  <Icon name="chevL" size={20} />
                </button>
                <div className="flex flex-1 items-center justify-center px-1 text-center text-[11.5px] font-medium text-text-faint">
                  {atEnd ? "Last step — tap Finish when you’re done" : "Swipe or tap to move between steps"}
                </div>
                {atEnd ? (
                  <button
                    type="button"
                    onClick={exit}
                    aria-label="Finish cooking"
                    className="inline-flex h-[50px] shrink-0 items-center gap-2 rounded-pill border border-accent bg-accent px-[18px] text-[15px] font-medium text-accent-ink"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    <Icon name="check" size={19} style={{ color: "var(--accent-ink)" }} />
                    Finish
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={goNext}
                    aria-label="Next step"
                    className="grid h-[50px] w-[50px] shrink-0 place-items-center rounded-pill border border-accent bg-accent text-accent-ink"
                  >
                    <Icon name="chevR" size={20} style={{ color: "var(--accent-ink)" }} />
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── desktop ingredient rail (sticky) + timers ── */}
        <aside className="hidden w-[380px] shrink-0 flex-col border-l border-line bg-surface lg:flex">
          <div className="flex items-center justify-between border-b border-line px-5 py-[14px]">
            <div className="flex items-center gap-[9px]">
              <Icon name="list" size={16} style={{ color: "var(--accent-2)" }} />
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent" style={{ fontFamily: "var(--font-sans)" }}>
                Ingredients
              </span>
            </div>
            <ServingsControl servings={servings} onChange={setServings} suffix />
          </div>
          <div ref={railScrollRef} data-ing-scroll className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
            {ingredientRows}
          </div>
          <TimerPanel api={timers} variant="rail" />
        </aside>
      </div>

      {/* ── mobile ingredient panel (collapsible) ── */}
      <div className="flex shrink-0 flex-col border-t border-line bg-surface lg:hidden">
        <div className="flex items-center justify-between px-[18px] py-[10px]">
          <button
            type="button"
            onClick={() => setIngOpen((o) => !o)}
            className="flex items-center gap-2 bg-transparent p-0"
          >
            <Icon name="list" size={15} style={{ color: "var(--accent-2)" }} />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-accent" style={{ fontFamily: "var(--font-sans)" }}>
              Ingredients · {servingsLabel}
            </span>
            <Icon name={ingOpen ? "chevD" : "chevU"} size={15} style={{ color: "var(--text-faint)" }} />
          </button>
          {ingOpen && <ServingsControl servings={servings} onChange={setServings} />}
        </div>
        {ingOpen && (
          <div
            ref={ingScrollRef}
            data-ing-scroll
            className="overflow-y-auto px-[18px] pb-3"
            style={{ maxHeight: "38vh" }}
          >
            {ingredientRows}
          </div>
        )}
      </div>

      {/* mobile floating timer dock (scroll-independent, above the footer) */}
      <TimerPanel api={timers} variant="float" />
    </div>
  );
}

// ───────────────────────── atoms ─────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="tnum inline-grid h-[22px] min-w-[22px] place-items-center rounded-[6px] border border-line bg-surface-2 px-[5px] text-[12px] text-text-dim"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {children}
    </kbd>
  );
}

function DishThumb({ dish }: { dish: Dish }) {
  if (dish.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={dish.imageUrl}
        alt=""
        className="h-8 w-8 shrink-0 rounded-[8px] object-cover lg:h-10 lg:w-10 lg:rounded-[10px]"
      />
    );
  }
  return (
    <div
      className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-[17px] lg:h-10 lg:w-10 lg:rounded-[10px] lg:text-[21px]"
      style={{
        background: `linear-gradient(135deg, ${dish.accent || "oklch(70% 0.14 40)"}, oklch(from ${dish.accent || "oklch(70% 0.14 40)"} calc(l + 0.1) c calc(h - 20)))`,
      }}
    >
      {dish.emoji || "🍽️"}
    </div>
  );
}

function ServingsControl({
  servings,
  onChange,
  suffix = false,
}: {
  servings: number;
  onChange: (n: number) => void;
  suffix?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, servings - 1))}
        aria-label="Fewer servings"
        className="grid h-[28px] w-[28px] place-items-center rounded-[7px] border-0 bg-surface-2 text-text transition-colors hover:bg-surface-3"
      >
        <Icon name="minus" size={14} />
      </button>
      <span
        className="tnum text-center text-text"
        style={{ fontFamily: "var(--font-serif)", fontSize: 16, minWidth: suffix ? 46 : 16 }}
      >
        {servings}
        {suffix && (
          <span className="text-[11px] text-text-faint" style={{ fontFamily: "var(--font-sans)" }}>
            {" "}
            srv
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => onChange(servings + 1)}
        aria-label="More servings"
        className="grid h-[28px] w-[28px] place-items-center rounded-[7px] border-0 bg-surface-2 text-text transition-colors hover:bg-surface-3"
      >
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

// ───────────────────── ingredient rows ─────────────────────

type IngGroup = ReturnType<typeof groupIngredientsBySection<Ingredient>>[number];

function IngredientRows({
  groups,
  highlighted,
  registerRef,
  empty,
}: {
  groups: IngGroup[];
  highlighted: Set<number>;
  registerRef: (idx: number, el: HTMLElement | null) => void;
  empty: boolean;
}) {
  if (empty) {
    return <div className="py-3 text-[13px] italic text-text-faint">No ingredients listed.</div>;
  }
  return (
    <div>
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.title && (
            <div
              className="mb-[2px] text-[10px] font-semibold uppercase tracking-[0.14em] text-text-faint"
              style={{ fontFamily: "var(--font-sans)", marginTop: gi ? 12 : 6 }}
            >
              {group.title}
            </div>
          )}
          {group.items.map(({ item: ing, index: i }, j) => (
            <div
              key={i}
              ref={(el) => registerRef(i, el)}
              className="-mx-[8px] rounded-[8px] px-[8px] transition-[background,box-shadow] duration-300"
              style={{
                background: highlighted.has(i) ? "var(--accent-tint)" : "transparent",
                boxShadow: highlighted.has(i) ? "inset 2px 0 0 var(--accent)" : "none",
              }}
            >
              <IngredientLine ing={ing} />
              {j < group.items.length - 1 && <div className="h-px bg-line" />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function IngredientLine({ ing }: { ing: Ingredient }) {
  const unit = visibleUnit(ing.unit);
  const qs = ing.quantity ? formatQty(ing.quantity) : "";
  const fixed = ing.scalable === false;
  return (
    <div
      className="flex items-baseline gap-3 py-[10px]"
      style={{ opacity: ing.pantry ? 0.5 : 1 }}
    >
      <div
        className="tnum min-w-[62px] shrink-0 text-[14px] font-semibold"
        style={{ color: fixed ? "var(--text-dim)" : "var(--text)" }}
      >
        {qs}
        {qs && unit ? " " : ""}
        {unit}
      </div>
      <div className="flex-1 text-[14px] leading-[1.35]">
        <span className="text-text">
          {ing.descriptor && <span className="text-text-dim">{ing.descriptor} </span>}
          {ing.name}
        </span>
        {ing.preparation && <span className="text-text-faint">, {ing.preparation}</span>}
        {ing.optional && <span className="text-text-faint"> (optional)</span>}
      </div>
    </div>
  );
}
