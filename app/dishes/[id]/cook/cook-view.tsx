"use client";
/* eslint-disable react-hooks/refs */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dish, Ingredient } from "@/lib/types";
import { Icon } from "@/app/_components/icon";
import { StepperButton } from "@/app/_components/ui";
import {
  formatQty,
  scaleIngredient,
  visibleUnit,
} from "@/lib/ingredients";
import { findTimers } from "@/lib/timer-parse";
import { useTimers } from "./use-timers";
import TimerPanel from "./timer-panel";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Span =
  | { kind: "ingredient"; start: number; end: number; idx: number }
  | { kind: "timer"; start: number; end: number; seconds: number; label: string };

function findIngredientSpans(text: string, ingredients: Ingredient[]): Span[] {
  if (ingredients.length === 0) return [];
  const entries = ingredients
    .map((ing, idx) => ({ name: ing.name.trim(), idx }))
    .filter((e) => e.name.length >= 3)
    .sort((a, b) => b.name.length - a.name.length);
  if (entries.length === 0) return [];

  const alternation = entries.map((e) => escapeRegex(e.name)).join("|");
  const re = new RegExp(`\\b(?:${alternation})s?\\b`, "gi");
  const spans: Span[] = [];

  for (const m of text.matchAll(re)) {
    const matched = m[0];
    const normalized = matched.replace(/s$/i, "").toLowerCase();
    const hit = entries.find(
      (e) =>
        e.name.toLowerCase() === normalized ||
        e.name.toLowerCase() === matched.toLowerCase(),
    );
    if (!hit) continue;
    const start = m.index ?? 0;
    spans.push({
      kind: "ingredient",
      start,
      end: start + matched.length,
      idx: hit.idx,
    });
  }
  return spans;
}

// Linkify a step's plain text. Matches ingredient names (clickable to
// scroll their row into view) and duration patterns like "15 min" /
// "2 hours" (clickable to start a countdown timer). Overlapping spans
// resolve earliest-start-wins; equal starts favor the longer span.
function linkifyStep(
  text: string,
  ingredients: Ingredient[],
  onTapIngredient: (index: number) => void,
  onStartTimer: (label: string, seconds: number) => void,
): React.ReactNode[] {
  const ingredientSpans = findIngredientSpans(text, ingredients);
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

  // Drop overlapping spans — earlier (or longer, on tie) wins.
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
    if (s.start > lastIndex) {
      parts.push(text.slice(lastIndex, s.start));
    }
    const matched = text.slice(s.start, s.end);
    if (s.kind === "ingredient") {
      parts.push(
        <button
          key={`ing-${key++}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTapIngredient(s.idx);
          }}
          className="inline underline decoration-dotted decoration-emerald-500 underline-offset-2 hover:bg-emerald-100 dark:hover:bg-emerald-950"
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
          className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-amber-400 bg-amber-50 px-1.5 py-0 align-baseline text-[13px] font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
        >
          <span aria-hidden="true">⏱</span>
          {matched}
        </button>,
      );
    }
    lastIndex = s.end;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

type Section = {
  title: string | null;
  steps: string[];
};

// Parse a simple recipe markdown blob into sections with steps.
// Recognizes:
//   ## Heading   — starts a new section
//   1. Step text — numbered list item
//   - Step text  — bulleted list item
// Other content is ignored (blank lines, free paragraphs, etc.).
function parseRecipe(md: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  const ensureSection = () => {
    if (!current) {
      current = { title: null, steps: [] };
      sections.push(current);
    }
    return current;
  };

  for (const rawLine of md.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      current = { title: heading[1].trim(), steps: [] };
      sections.push(current);
      continue;
    }

    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      ensureSection().steps.push(numbered[1].trim());
      continue;
    }

    const bulleted = line.match(/^[-*]\s+(.*)$/);
    if (bulleted) {
      ensureSection().steps.push(bulleted[1].trim());
      continue;
    }

    // Paragraph (not a list item or heading). Treat it as its own step.
    ensureSection().steps.push(line);
  }

  return sections.filter((s) => s.steps.length > 0);
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
  const [doneSteps, setDoneSteps] = useState<Set<string>>(new Set());
  const [highlightedIdx, setHighlightedIdx] = useState<number | null>(null);
  const ingredientRefs = useRef<Array<HTMLLIElement | null>>([]);
  const wakeLock = useWakeLock();
  const timers = useTimers();

  const sections = useMemo(
    () => (dish.recipe ? parseRecipe(dish.recipe) : []),
    [dish.recipe],
  );

  const scaledIngredients: Ingredient[] = useMemo(
    () =>
      dish.ingredients.map((ing) =>
        scaleIngredient(ing, servings, dish.baseServings),
      ),
    [dish.ingredients, servings, dish.baseServings],
  );

  function toggleStep(key: string) {
    setDoneSteps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const scrollToIngredient = useCallback((idx: number) => {
    const el = ingredientRefs.current[idx];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedIdx(idx);
    window.setTimeout(() => {
      setHighlightedIdx((cur) => (cur === idx ? null : cur));
    }, 1600);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="flex items-center gap-3 border-b border-rule-soft bg-paper px-4 py-3">
        <button
          type="button"
          onClick={() => router.push(`/dishes/${dish.id}`)}
          aria-label="Exit"
          className="grid h-9 w-9 place-items-center rounded-pill border border-rule bg-bg text-ink"
        >
          <Icon name="x" size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">Cooking</div>
          <div className="truncate text-[18px] font-medium text-ink" style={{ fontFamily: "var(--font-disp)" }}>
            {dish.title}
          </div>
        </div>
        <div className="flex items-center gap-1 text-[12px] text-ink-2" style={{ fontFamily: "var(--font-mono)" }}>
          <StepperButton kind="minus" onClick={() => setServings((s) => Math.max(1, s - 1))} ariaLabel="Fewer" />
          <span className="min-w-6 text-center">{servings}</span>
          <StepperButton kind="plus" onClick={() => setServings((s) => s + 1)} ariaLabel="More" />
        </div>
      </header>

      <div className="flex max-h-[40vh] flex-shrink-0 flex-col border-b border-rule bg-paper">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Ingredients · serves {servings}
          </div>
          <div className="text-[10px] text-ink-3">
            {wakeLock.supported === false ? "screen may auto-lock" : wakeLock.active ? "screen lock prevented" : "…"}
          </div>
        </div>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 overflow-auto px-4 pb-3 text-[14px]">
          {scaledIngredients.map((ing, i) => {
            const unit = visibleUnit(ing.unit);
            const pantry = !!ing.pantry;
            const optional = !!ing.optional;
            const highlighted = highlightedIdx === i;
            return (
              <li
                key={i}
                ref={(el) => { ingredientRefs.current[i] = el; }}
                className={[
                  "rounded-md px-2 py-1 transition-colors",
                  highlighted ? "bg-accent-tint" : "",
                  pantry ? "italic text-ink-3" : "text-ink",
                ].join(" ")}
              >
                <span className="text-[12px] text-ink-3" style={{ fontFamily: "var(--font-mono)" }}>
                  {formatQty(ing.quantity)}{unit ? ` ${unit}` : ""}
                </span>{" "}
                {ing.descriptor && <span className="text-ink-3">{ing.descriptor} </span>}
                {ing.name}
                {optional && <span className="text-[11px] text-ink-3"> (optional)</span>}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {sections.length === 0 ? (
          <p className="text-[13px] text-ink-3">No recipe text.</p>
        ) : (
          sections.map((section, si) => (
            <section key={si} className="mb-6">
              {section.title && (
                <h2 className="mb-2 text-[18px] italic font-medium text-accent" style={{ fontFamily: "var(--font-disp)" }}>
                  {section.title}
                </h2>
              )}
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {section.steps.map((step, stepIdx) => {
                  const key = `${si}:${stepIdx}`;
                  const done = doneSteps.has(key);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => toggleStep(key)}
                        className={[
                          "flex w-full items-start gap-3 rounded-lg border p-3 text-left text-[15px] leading-snug transition-colors",
                          done
                            ? "border-rule-soft bg-bg text-ink-3 line-through"
                            : "border-rule bg-paper text-ink hover:border-ink-3",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "mt-[2px] grid h-6 w-6 shrink-0 place-items-center rounded-pill border text-[11px] font-semibold",
                            done ? "border-accent bg-accent text-accent-ink" : "border-rule bg-bg text-ink-2",
                          ].join(" ")}
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {done ? <Icon name="check" size={12} /> : stepIdx + 1}
                        </span>
                        <span className="flex-1">
                          {linkifyStep(step, scaledIngredients, scrollToIngredient, timers.start)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))
        )}
      </div>

      <TimerPanel api={timers} />
    </div>
  );
}
