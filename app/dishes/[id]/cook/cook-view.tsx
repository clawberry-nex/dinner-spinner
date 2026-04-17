"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Dish, Ingredient } from "@/lib/types";
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
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Cooking
          </div>
          <h1 className="text-2xl font-bold sm:text-3xl">{dish.title}</h1>
          {dish.subtitle && (
            <p className="text-sm text-zinc-500">{dish.subtitle}</p>
          )}
        </div>
        <Link
          href={`/dishes/${dish.id}`}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          ✕ Exit
        </Link>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-sm font-semibold">Serves:</span>
          <button
            type="button"
            onClick={() => setServings((s) => Math.max(1, s - 1))}
            className="h-8 w-8 rounded border border-zinc-300 text-lg dark:border-zinc-700"
          >
            −
          </button>
          <span className="w-8 text-center font-mono text-lg">{servings}</span>
          <button
            type="button"
            onClick={() => setServings((s) => s + 1)}
            className="h-8 w-8 rounded border border-zinc-300 text-lg dark:border-zinc-700"
          >
            +
          </button>
          <span className="ml-auto text-xs text-zinc-500">
            {wakeLock.supported === false
              ? "screen may auto-lock"
              : wakeLock.active
                ? "screen lock prevented"
                : "…"}
          </span>
        </div>
        <ul className="grid grid-cols-1 gap-1 text-[17px] sm:grid-cols-2">
          {scaledIngredients.map((ing, i) => {
            const unit = visibleUnit(ing.unit);
            const pantry = !!ing.pantry;
            const optional = !!ing.optional;
            const isHighlighted = highlightedIdx === i;
            return (
              <li
                key={i}
                ref={(el) => {
                  ingredientRefs.current[i] = el;
                }}
                className={`rounded px-1 transition-colors ${
                  pantry ? "italic text-zinc-400" : ""
                } ${
                  isHighlighted
                    ? "bg-emerald-200 dark:bg-emerald-900"
                    : ""
                }`}
              >
                <span className="font-mono">{formatQty(ing.quantity)}</span>
                {unit ? ` ${unit}` : ""}
                {ing.descriptor ? ` ${ing.descriptor}` : ""} {ing.name}
                {ing.alternatives && ing.alternatives.length > 0 && (
                  <span className="text-zinc-500">
                    {" "}
                    (or {ing.alternatives.join(", ")})
                  </span>
                )}
                {optional && (
                  <span className="ml-1 text-xs text-zinc-500">
                    (optional)
                  </span>
                )}
                {pantry && (
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-zinc-400">
                    pantry
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-6">
        {sections.length === 0 ? (
          <p className="text-zinc-500">No recipe text.</p>
        ) : (
          sections.map((section, si) => (
            <div key={si} className="flex flex-col gap-2">
              {section.title && (
                <h2 className="text-xl font-semibold text-emerald-700 dark:text-emerald-400">
                  {section.title}
                </h2>
              )}
              <ol className="flex flex-col gap-2">
                {section.steps.map((step, stepIdx) => {
                  const key = `${si}:${stepIdx}`;
                  const done = doneSteps.has(key);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => toggleStep(key)}
                        className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left text-[17px] leading-snug transition ${
                          done
                            ? "border-zinc-200 bg-zinc-100 text-zinc-400 line-through dark:border-zinc-800 dark:bg-zinc-900/50"
                            : "border-zinc-300 bg-white hover:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                            done
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : "border-zinc-400 text-zinc-400"
                          }`}
                        >
                          {done ? "✓" : stepIdx + 1}
                        </span>
                        <span className="flex-1">
                          {linkifyStep(
                            step,
                            scaledIngredients,
                            scrollToIngredient,
                            timers.start,
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))
        )}
      </section>

      <div className="py-6 text-center">
        <Link
          href={`/dishes/${dish.id}`}
          className="text-sm text-zinc-500 hover:underline"
        >
          ← Back to dish
        </Link>
      </div>

      <TimerPanel api={timers} />
    </div>
  );
}
