"use client";

import { formatRemaining, type TimerApi } from "./use-timers";

export default function TimerPanel({ api }: { api: TimerApi }) {
  if (api.timers.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {api.timers.map((t) => {
        const { text, done } = formatRemaining(t, api.now);
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 rounded-lg border px-3 py-2 shadow-lg transition-colors ${
              done
                ? "animate-pulse border-red-500 bg-red-500 text-white"
                : "border-emerald-600 bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
            }`}
          >
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wide opacity-80">
                {done ? "done" : t.label}
              </span>
              <span className="font-mono text-lg leading-tight">{text}</span>
            </div>
            <button
              type="button"
              onClick={() => api.dismiss(t.id)}
              aria-label="Dismiss timer"
              className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                done
                  ? "bg-white/20 hover:bg-white/30"
                  : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
              }`}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
