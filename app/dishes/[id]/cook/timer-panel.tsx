"use client";

import { Icon } from "@/app/_components/icon";
import { formatRemaining, type TimerApi } from "./use-timers";

// Cook-mode running-timer dock. Driven entirely by the existing useTimers API
// (timers / dismiss / now + formatRemaining) — only the presentation is V2.
//
// Two placements:
//   "float" — mobile: a fixed dock floating above the bottom footer, always
//             visible regardless of step-text scroll.
//   "rail"  — desktop: rendered inline at the bottom of the sticky ingredient
//             rail (under the "Timers" eyebrow), per the prototype.
export default function TimerPanel({
  api,
  variant = "float",
}: {
  api: TimerApi;
  variant?: "float" | "rail";
}) {
  if (api.timers.length === 0) return null;

  const cards = (
    <div className="flex flex-col gap-[9px]">
      {api.timers.map((t) => {
        const { text, done } = formatRemaining(t, api.now);
        return (
          <div
            key={t.id}
            className={[
              "flex items-center gap-3 rounded-[var(--radius-md)] border px-[14px] py-[11px]",
              done
                ? "border-rose bg-rose-tint"
                : variant === "rail"
                  ? "border-line bg-surface-2"
                  : "border-line bg-surface shadow-[var(--shadow-card)]",
            ].join(" ")}
            style={done ? { animation: "ds-flash 0.9s ease infinite" } : undefined}
            role={done ? "alert" : undefined}
          >
            <Icon
              name={done ? "bell" : "timer"}
              size={20}
              style={{ color: done ? "var(--rose)" : "var(--accent-2)" }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-text">
                {done ? "Time’s up!" : t.label}
              </div>
              <div
                className="tnum leading-[1.1]"
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 21,
                  color: done ? "var(--rose)" : "var(--text)",
                }}
              >
                {text}
              </div>
            </div>
            <button
              type="button"
              onClick={() => api.dismiss(t.id)}
              aria-label={done ? "Dismiss timer" : "Cancel timer"}
              className="shrink-0 rounded-pill bg-surface-2 px-3 py-[7px] text-[12.5px] font-medium text-text-dim transition-colors hover:bg-surface-3"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {done ? "Dismiss" : "Cancel"}
            </button>
          </div>
        );
      })}
    </div>
  );

  if (variant === "rail") {
    return (
      <div className="border-t border-line p-[16px_18px]">
        <div className="mb-[10px] px-[2px] text-[11px] font-semibold uppercase tracking-[0.18em] text-text-faint">
          Timers
        </div>
        {cards}
      </div>
    );
  }

  // Mobile floating dock — pinned above the footer, scroll-independent.
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[64px] z-[90] flex justify-center px-[18px]">
      <div className="pointer-events-auto max-h-[40vh] w-full max-w-[440px] overflow-y-auto">
        {cards}
      </div>
    </div>
  );
}
