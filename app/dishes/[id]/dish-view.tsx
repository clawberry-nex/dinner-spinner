"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/app/_components/app-header";
import { DishArt, Badge, Button, StepperButton, useToast } from "@/app/_components/ui";
import { Icon } from "@/app/_components/icon";
import { MarkdownLite } from "@/app/_components/markdown-lite";
import type { CookLogEntry, Dish } from "@/lib/types";
import { computeDietFlags, formatDietChips } from "@/lib/diet";
import { clearLastServings, readLastServings, writeLastServings } from "@/lib/last-servings";

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 14) return `${Math.floor(d)}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
function formatQty(q: number): string {
  const rounded = Math.round(q * 100) / 100;
  return rounded.toFixed(2).replace(/\.?0+$/, "");
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
  const resetServings = () => {
    setServings(initial.baseServings);
    clearLastServings(initial.id);
  };
  const [cookFormOpen, setCookFormOpen] = useState(false);
  const [inPlan, setInPlan] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return (JSON.parse(localStorage.getItem("mealPlan") || "[]") as { id: number }[]).some((e) => e.id === initial.id);
    } catch { return false; }
  });
  const toast = useToast();

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

  const ratio = servings / dish.baseServings;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <AppHeader back />
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-20">
       <div className="mx-auto w-full max-w-3xl">
        <div className="px-4"><DishArt dish={dish} size="100%" corner="var(--radius-lg)" className="md:max-h-[320px] md:object-cover" /></div>

        <div className="px-5 pt-5 pb-3">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h1 className="m-0 text-[32px] font-medium leading-[1.05] tracking-[-0.025em] text-ink" style={{ fontFamily: "var(--font-disp)" }}>
                {dish.title}
              </h1>
              {dish.subtitle && <div className="mt-1 text-[14px] italic text-ink-2">{dish.subtitle}</div>}
            </div>
            {isOwner && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => router.push(`/dishes/${dish.id}/edit`)}
                  aria-label="Edit dish"
                  className="grid h-10 w-10 place-items-center rounded-pill border border-rule bg-paper text-ink-2"
                >
                  <Icon name="pencil" size={18} />
                </button>
                <button
                  type="button"
                  onClick={favorite}
                  aria-label={dish.favorite ? "Remove favourite" : "Mark as favourite"}
                  className={[
                    "grid h-10 w-10 place-items-center rounded-pill border",
                    dish.favorite ? "border-accent bg-accent text-accent-ink" : "border-rule bg-paper text-ink-2",
                  ].join(" ")}
                >
                  <Icon name={dish.favorite ? "star-fill" : "star"} size={18} />
                </button>
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            {dish.tags.map((t) => (
              <span key={t} className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">· {t}</span>
            ))}
            <span className="flex-1" />
            {isOwner ? (
              <span className="text-[11px] text-ink-3" style={{ fontFamily: "var(--font-mono)" }}>
                last cooked {relTime(dish.lastCookedAt)}
                {dish.ratingCount > 0 && (
                  <>
                    {" · "}
                    <span aria-label={`Average rating ${fmtAvg(dish.averageRating)} from ${dish.ratingCount} cooks`}>
                      ★ {fmtAvg(dish.averageRating)} ({dish.ratingCount})
                    </span>
                  </>
                )}
              </span>
            ) : ownerHandle ? (
              <Link
                href={`/u/${ownerHandle}`}
                className="text-[11px] text-ink-3 hover:text-ink-2"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                by {ownerName?.trim() || `@${ownerHandle}`}
              </Link>
            ) : null}
          </div>
          <DietChipRow dish={dish} />
        </div>

        <div className="mx-4 mb-4 rounded-lg border border-rule bg-paper p-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Serves</div>
              <div className="text-[13px] text-ink-3" style={{ fontFamily: "var(--font-mono)" }}>
                base: {dish.baseServings}
                {servings !== dish.baseServings && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={resetServings}
                      className="underline decoration-ink-3/40 underline-offset-2 hover:text-ink-2"
                    >
                      reset
                    </button>
                  </>
                )}
              </div>
            </div>
            <StepperButton kind="minus" onClick={() => setServings((s) => Math.max(1, s - 1))} ariaLabel="Fewer servings" />
            <div className="min-w-9 text-center text-[28px] font-medium text-ink" style={{ fontFamily: "var(--font-disp)" }}>{servings}</div>
            <StepperButton kind="plus" onClick={() => setServings((s) => s + 1)} ariaLabel="More servings" />
          </div>
          {isOwner && (
            <>
              <div className="mt-4 flex gap-2">
                <Button variant="ink" size="md" onClick={() => router.push(`/dishes/${dish.id}/cook?servings=${servings}`)} className="flex-1">
                  <Icon name="flame" size={16} /> Cook mode
                </Button>
                <Button variant="ghost" size="md" onClick={() => setCookFormOpen(true)}>
                  <Icon name="check" size={14} /> Cooked
                </Button>
              </div>
              <Button variant="ghost" size="md" onClick={addToPlan} className={["mt-2 w-full", inPlan ? "!text-good" : ""].join(" ")}>
                <Icon name={inPlan ? "check" : "cart"} size={14} />
                {inPlan ? `In plan (update to ${servings})` : "Add to meal plan"}
              </Button>
            </>
          )}
        </div>

        {isOwner && dish.notes && (
          <div
            className="mx-4 mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-ink dark:border-amber-700/60 dark:bg-amber-950/40"
            aria-label="Dish notes"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-300">
              Notes
            </div>
            <p
              className="mt-1 whitespace-pre-wrap text-[14px] leading-snug"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {dish.notes}
            </p>
          </div>
        )}

        <div className="px-5 pb-2">
          <SectionHeader>Ingredients</SectionHeader>
          <div className="mt-2">
            {dish.ingredients.map((ing, i) => {
              const qty = (ing.quantity ?? 0) * (ing.scalable === false ? 1 : ratio);
              const unit = ing.unit && ing.unit !== "piece" ? ` ${ing.unit}` : "";
              return (
                <div
                  key={i}
                  className={["flex items-baseline gap-3 border-b border-rule-soft py-[10px]", ing.pantry ? "italic text-ink-3" : "text-ink"].join(" ")}
                >
                  <span className="min-w-[52px] text-right text-[12px] font-medium text-ink-3" style={{ fontFamily: "var(--font-mono)" }}>
                    {ing.quantity ? formatQty(qty) : ""}{unit}
                  </span>
                  <span className="flex-1 text-[14px] leading-snug" style={{ fontFamily: "var(--font-sans)" }}>
                    {ing.descriptor && <span className="text-ink-3">{ing.descriptor} </span>}
                    {ing.name}
                    {ing.alternatives?.length ? <span className="text-ink-3"> (or {ing.alternatives.join(", ")})</span> : null}
                    {ing.preparation && <span className="text-ink-3">, {ing.preparation}</span>}
                    {ing.optional && <span className="text-ink-3"> (optional)</span>}
                  </span>
                  <span className="flex gap-1">
                    {ing.pantry && <Badge>pantry</Badge>}
                    {ing.scalable === false && <Badge>fixed</Badge>}
                  </span>
                </div>
              );
            })}
            {!dish.ingredients.length && <div className="py-4 text-[13px] text-ink-3">No ingredients listed.</div>}
          </div>
        </div>

        {isOwner && history.length > 0 && (
          <div className="px-5 pt-4">
            <SectionHeader>Cook history</SectionHeader>
            <div className="mt-3 flex flex-col gap-[10px]">
              {history.map((entry) => (
                <CookHistoryCard key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
        )}

        {dish.recipe && (
          <div className="px-5 pt-4 pb-8">
            <SectionHeader>The recipe</SectionHeader>
            <div className="mt-3 text-[15px] leading-[1.55] text-ink" style={{ fontFamily: "var(--font-sans)" }}>
              <MarkdownLite text={dish.recipe} />
            </div>
          </div>
        )}
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

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-center gap-[10px]">
      <h2 className="m-0 text-[22px] italic font-medium tracking-[-0.01em] text-ink" style={{ fontFamily: "var(--font-disp)" }}>{children}</h2>
      <div className="h-px flex-1 bg-rule" />
    </div>
  );
}

function StarPicker({ value, onChange }: { value: number | null; onChange: (n: number | null) => void }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value != null && n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => onChange(value === n ? null : n)}
            className={[
              "grid h-10 w-10 place-items-center rounded-pill border transition-colors",
              filled ? "border-accent bg-accent text-accent-ink" : "border-rule bg-paper text-ink-3 hover:border-ink-3",
            ].join(" ")}
          >
            <Icon name={filled ? "star-fill" : "star"} size={18} />
          </button>
        );
      })}
      {value != null && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-2 text-[11px] uppercase tracking-[0.1em] text-ink-3 hover:text-ink-2"
        >
          clear
        </button>
      )}
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
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await onSubmit(rating, note.trim() || null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Log a cook"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="w-full max-w-[420px] rounded-t-xl border border-rule bg-paper p-5 shadow-[0_-16px_32px_rgba(0,0,0,0.12)] sm:rounded-lg sm:shadow-[0_16px_32px_rgba(0,0,0,0.18)]"
        style={{ animation: "revealUp 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)" }}
      >
        <div className="mb-2 flex items-start justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Log a cook</div>
            <h3 className="m-0 mt-[2px] text-[22px] italic font-medium tracking-[-0.01em] text-ink" style={{ fontFamily: "var(--font-disp)" }}>
              How did it go?
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            disabled={busy}
            className="p-1 text-lg leading-none text-ink-3 disabled:opacity-40"
          >
            ×
          </button>
        </div>

        <div className="mt-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Rating (optional)</div>
          <StarPicker value={rating} onChange={setRating} />
        </div>

        <div className="mt-4">
          <label htmlFor="cook-note" className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
            Note (optional)
          </label>
          <textarea
            id="cook-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Too much chili, kids loved it, halve the sugar next time…"
            rows={3}
            maxLength={2000}
            className="w-full resize-y rounded-md border border-rule bg-bg px-3 py-2 text-[14px] text-ink placeholder:text-ink-3 focus:border-ink-3 focus:outline-none"
          />
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="ghost" size="md" onClick={onCancel} disabled={busy} className="flex-1">
            Cancel
          </Button>
          <Button variant="ink" size="md" onClick={save} disabled={busy} className="flex-1">
            <Icon name="check" size={14} /> {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      <style>{`@keyframes revealUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}

function CookHistoryCard({ entry }: { entry: CookLogEntry }) {
  const when = new Date(entry.cookedAt);
  const date = when.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="rounded-lg border border-rule bg-paper p-[14px]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3" style={{ fontFamily: "var(--font-mono)" }}>
          {date} · {relTime(entry.cookedAt)}
        </div>
        {entry.rating != null && <StarRow value={entry.rating} />}
      </div>
      {entry.note && (
        <p className="mt-2 whitespace-pre-wrap text-[14px] leading-snug text-ink">
          {entry.note}
        </p>
      )}
    </div>
  );
}

function DietChipRow({ dish }: { dish: Dish }) {
  if (!dish.ingredients.length) return null;
  const flags = computeDietFlags(dish.ingredients);
  const chips = formatDietChips(flags);
  if (!chips.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-[6px]" aria-label="Dietary info">
      {chips.map((c) => (
        <span
          key={c.label}
          className="inline-flex items-center rounded-pill border px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.1em]"
          style={
            c.tone === "good"
              ? {
                  color: "var(--good)",
                  borderColor: "color-mix(in oklch, var(--good) 40%, transparent)",
                  background: "color-mix(in oklch, var(--good) 12%, transparent)",
                }
              : {
                  color: "var(--ink-3)",
                  borderColor: "var(--rule)",
                  background: "var(--bg-alt)",
                }
          }
          title={c.tone === "good" ? "Computed from ingredients" : "Heads-up, derived from ingredients"}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

function StarRow({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-[2px] text-accent" aria-label={`${value} star${value === 1 ? "" : "s"}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name={n <= value ? "star-fill" : "star"} size={14} style={n > value ? { color: "var(--ink-3)" } : undefined} />
      ))}
    </span>
  );
}
