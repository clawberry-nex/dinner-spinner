"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DishArt } from "@/app/_components/ui";
import { Icon } from "@/app/_components/icon";
import { DEMO_DISHES } from "@/lib/demo/dishes";
import { readPlan, writePlan } from "@/lib/plan-storage";

const KEY = "demoMealPlan";

// Lightweight read-only library for the demo. A simple grid (no filters/sort)
// so it doesn't depend on the full /dishes page. The only interaction is an
// ephemeral add-to-plan toggle, written to the isolated demo key.
export function DemoLibrary() {
  const [planIds, setPlanIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    setPlanIds(new Set(readPlan(KEY).map((e) => e.id)));
  }, []);

  const toggle = (id: number, baseServings: number) => {
    const list = readPlan(KEY);
    const inPlan = list.some((e) => e.id === id);
    const next = inPlan
      ? list.filter((e) => e.id !== id)
      : [...list, { id, servings: baseServings }];
    writePlan(KEY, next);
    setPlanIds(new Set(next.map((e) => e.id)));
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-28 lg:pb-12">
        <div className="mx-auto flex w-full max-w-6xl flex-col px-5 pt-[var(--safe-top)] lg:px-10">
          <div className="lg:mt-2">
            <div className="mb-[10px] text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              Library
            </div>
            <h1
              className="m-0 font-medium leading-[1.04] tracking-[-0.02em] text-text"
              style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(30px,6vw,42px)" }}
            >
              The collection
            </h1>
            <div className="mt-2 text-[13.5px] text-text-dim lg:text-[15px]">
              {DEMO_DISHES.length} dishes
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-[13px] lg:mt-8 lg:grid-cols-[repeat(auto-fill,minmax(212px,1fr))] lg:gap-[22px]">
            {DEMO_DISHES.map((d) => {
              const inPlan = planIds.has(d.id);
              return (
                <Link
                  key={d.id}
                  href={`/demo/dishes/${d.id}`}
                  className="group flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-card)] transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-[3px] hover:border-line-2"
                >
                  <div className="relative w-full overflow-hidden" style={{ aspectRatio: "1.2" }}>
                    <DishArt dish={d} fill emojiSize={64} />
                  </div>
                  <div className="flex flex-1 flex-col p-[11px_13px_13px]">
                    <h3
                      className="line-clamp-2 text-[16.5px] font-semibold leading-[1.16] tracking-[-0.01em] text-text"
                      style={{ fontFamily: "var(--font-serif)", minHeight: "2.32em" }}
                    >
                      {d.title}
                    </h3>
                    {d.subtitle && (
                      <div className="mt-[3px] line-clamp-1 text-[12px] italic text-text-dim">{d.subtitle}</div>
                    )}
                    <div className="min-h-[11px] flex-1" />
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(d.id, d.baseServings); }}
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
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
