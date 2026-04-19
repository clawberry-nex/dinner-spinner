"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/app/_components/app-header";
import { DishArt, Badge, Button, StepperButton, useToast } from "@/app/_components/ui";
import { Icon } from "@/app/_components/icon";
import { MarkdownLite } from "@/app/_components/markdown-lite";
import type { Dish } from "@/lib/types";

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
  return String(Math.round(q * 100) / 100).replace(/\.?0+$/, "");
}

export default function DishView({ dish: initial }: { dish: Dish }) {
  const router = useRouter();
  const [dish, setDish] = useState(initial);
  const [servings, setServings] = useState(initial.baseServings);
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

  const cooked = async () => {
    try {
      const res = await fetch("/api/cook-log", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ dishId: dish.id }),
      });
      if (res.ok) { setDish((d) => ({ ...d, lastCookedAt: new Date().toISOString() })); toast.show("Logged as cooked"); }
    } catch {}
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
      <div className="flex-1 overflow-auto pb-20">
        <div className="px-4"><DishArt dish={dish} size="100%" corner="var(--radius-lg)" className="md:max-h-[320px] md:object-cover" /></div>

        <div className="px-5 pt-5 pb-3">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h1 className="m-0 text-[32px] font-medium leading-[1.05] tracking-[-0.025em] text-ink" style={{ fontFamily: "var(--font-disp)" }}>
                {dish.title}
              </h1>
              {dish.subtitle && <div className="mt-1 text-[14px] italic text-ink-2">{dish.subtitle}</div>}
            </div>
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
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            {dish.tags.map((t) => (
              <span key={t} className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">· {t}</span>
            ))}
            <span className="flex-1" />
            <span className="text-[11px] text-ink-3" style={{ fontFamily: "var(--font-mono)" }}>last cooked {relTime(dish.lastCookedAt)}</span>
          </div>
        </div>

        <div className="mx-4 mb-4 rounded-lg border border-rule bg-paper p-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Serves</div>
              <div className="text-[13px] text-ink-3" style={{ fontFamily: "var(--font-mono)" }}>base: {dish.baseServings}</div>
            </div>
            <StepperButton kind="minus" onClick={() => setServings((s) => Math.max(1, s - 1))} ariaLabel="Fewer servings" />
            <div className="min-w-9 text-center text-[28px] font-medium text-ink" style={{ fontFamily: "var(--font-disp)" }}>{servings}</div>
            <StepperButton kind="plus" onClick={() => setServings((s) => s + 1)} ariaLabel="More servings" />
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="ink" size="md" onClick={() => router.push(`/dishes/${dish.id}/cook?servings=${servings}`)} className="flex-1">
              <Icon name="flame" size={16} /> Cook mode
            </Button>
            <Button variant="ghost" size="md" onClick={cooked}>
              <Icon name="check" size={14} /> Cooked
            </Button>
          </div>
          <Button variant="ghost" size="md" onClick={addToPlan} className={["mt-2 w-full", inPlan ? "!text-good" : ""].join(" ")}>
            <Icon name={inPlan ? "check" : "cart"} size={14} />
            {inPlan ? `In plan (update to ${servings})` : "Add to meal plan"}
          </Button>
        </div>

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

        {dish.recipe && (
          <div className="px-5 pt-4 pb-8">
            <SectionHeader>The recipe</SectionHeader>
            <div className="mt-3 text-[15px] leading-[1.55] text-ink" style={{ fontFamily: "var(--font-sans)" }}>
              <MarkdownLite text={dish.recipe} />
            </div>
          </div>
        )}
      </div>
      {toast.el}
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
