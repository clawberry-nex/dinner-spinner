"use client";

import { useCallback, useEffect, useState } from "react";

export type Timer = {
  id: string;
  label: string;
  durationSec: number;
  startedAt: number;
  finishedAt: number | null;
};

export type TimerApi = {
  timers: Timer[];
  start: (label: string, seconds: number) => void;
  dismiss: (id: string) => void;
  now: number;
};

function playBeep() {
  if (typeof window === "undefined") return;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return;
  try {
    const ctx = new AC();
    const base = ctx.currentTime;
    const tones: Array<[number, number]> = [
      [880, 0],
      [660, 0.22],
    ];
    for (const [freq, offset] of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = base + offset;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.3);
    }
    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1200);
  } catch {
    // AudioContext creation can fail without a user gesture.
  }
}

export function useTimers(): TimerApi {
  const [timers, setTimers] = useState<Timer[]>([]);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const iv = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      setTimers((prev) => {
        let changed = false;
        const next = prev.map((p) => {
          if (
            p.finishedAt === null &&
            t - p.startedAt >= p.durationSec * 1000
          ) {
            changed = true;
            playBeep();
            return { ...p, finishedAt: t };
          }
          return p;
        });
        return changed ? next : prev;
      });
    }, 250);
    return () => window.clearInterval(iv);
  }, []);

  const start = useCallback((label: string, seconds: number) => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setTimers((prev) => [
      ...prev,
      {
        id,
        label,
        durationSec: seconds,
        startedAt: Date.now(),
        finishedAt: null,
      },
    ]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setTimers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { timers, start, dismiss, now };
}

export function formatRemaining(
  timer: Timer,
  now: number,
): { text: string; done: boolean } {
  const remainingMs =
    timer.finishedAt !== null
      ? 0
      : Math.max(0, timer.startedAt + timer.durationSec * 1000 - now);
  const done = remainingMs <= 0;
  const totalSec = Math.ceil(remainingMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  const text = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return { text, done };
}
