"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dish } from "@/lib/types";

const FILTER_KEY = "spinnerFilters";

// Weighted pick that:
// - gives favourites a 2× base weight boost
// - de-weights dishes cooked recently: weight × min(1, daysSinceLast/14)
// - never-cooked dishes get the full base weight
function pickWeighted(dishes: Dish[]): Dish {
  const now = Date.now();
  const weights = dishes.map((d) => {
    let w = d.favorite ? 2 : 1;
    if (d.lastCookedAt) {
      const days = (now - new Date(d.lastCookedAt).getTime()) / 86_400_000;
      w *= Math.min(1, Math.max(0, days) / 14);
    }
    // Floor so a dish that's cooked today isn't impossible.
    return Math.max(0.05, w);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < dishes.length; i++) {
    r -= weights[i];
    if (r <= 0) return dishes[i];
  }
  return dishes[dishes.length - 1];
}

export default function SpinnerPage() {
  const router = useRouter();
  const [allTags, setAllTags] = useState<string[]>([]);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [spinLabel, setSpinLabel] = useState<string>("Press Spin");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tags")
      .then((r) => r.json() as Promise<string[]>)
      .then(setAllTags)
      .catch(() => setAllTags([]));
    try {
      const saved = localStorage.getItem(FILTER_KEY);
      if (saved) setActiveTags(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(activeTags));
    } catch {}
  }, [activeTags]);

  function toggleTag(tag: string) {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  async function spin() {
    setError(null);
    setSpinning(true);
    const qs = activeTags.length
      ? `?tags=${encodeURIComponent(activeTags.join(","))}`
      : "";
    try {
      const res = await fetch(`/api/dishes${qs}`);
      if (!res.ok) throw new Error("Failed to load dishes");
      const dishes = (await res.json()) as Dish[];
      if (dishes.length === 0) {
        setSpinning(false);
        setError("No dishes match the current filter.");
        setSpinLabel("Press Spin");
        return;
      }

      const shuffle = [...dishes].sort(() => Math.random() - 0.5);
      const frames = Math.min(20, shuffle.length * 3);
      let i = 0;
      const interval = setInterval(() => {
        setSpinLabel(shuffle[i % shuffle.length].title);
        i += 1;
        if (i >= frames) {
          clearInterval(interval);
          const picked = pickWeighted(dishes);
          setSpinLabel(picked.title);
          setSpinning(false);
          setTimeout(() => router.push(`/dishes/${picked.id}`), 400);
        }
      }, 80);
    } catch (e) {
      setSpinning(false);
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  return (
    <div className="flex flex-col items-center gap-8">
      <h1 className="text-4xl font-bold">Dinner Spinner</h1>

      {allTags.length > 0 && (
        <div className="w-full">
          <h2 className="mb-2 text-sm font-semibold uppercase text-zinc-500">
            Filter by tags (must match all)
          </h2>
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => {
              const active = activeTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    active
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-zinc-300 bg-white hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={spin}
        disabled={spinning}
        className="h-40 w-40 rounded-full bg-emerald-600 text-2xl font-bold text-white shadow-lg transition hover:bg-emerald-500 disabled:opacity-70"
      >
        {spinning ? "…" : "Spin!"}
      </button>

      <div className="min-h-8 text-center text-xl">{spinLabel}</div>
      {error && <div className="text-red-600">{error}</div>}
    </div>
  );
}
