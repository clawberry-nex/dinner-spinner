"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "./_components/app-header";
import { Chip, DishArt, Button } from "./_components/ui";
import { Icon } from "./_components/icon";
import type { Dish } from "@/lib/types";
import { pickWithRationale } from "@/lib/spinner";

export default function SpinnerPage() {
  const router = useRouter();
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState<Dish | null>(null);
  const [rationale, setRationale] = useState<string | null>(null);
  const [cycleIdx, setCycleIdx] = useState(0);
  const [rotation, setRotation] = useState(0);
  const timerRef = useRef<number | null>(null);

  // Hydrate filters from localStorage after mount (no SSR mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem("spinnerFilters");
      if (raw) setSelected(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("spinnerFilters", JSON.stringify(selected)); } catch {}
  }, [selected]);

  useEffect(() => {
    fetch("/api/tags").then((r) => r.json()).then(setAllTags).catch(() => {});
  }, []);

  const load = async (): Promise<Dish[]> => {
    const qs = selected.length ? `?tags=${encodeURIComponent(selected.join(","))}` : "";
    const res = await fetch(`/api/dishes${qs}`);
    const data: Dish[] = await res.json();
    setDishes(data);
    return data;
  };

  // `load` is stable enough for this effect; re-creating it on every render
  // would cause an infinite loop. selected.join(",") is the real trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [selected.join(",")]);

  const toggleTag = (t: string) => {
    setLanded(null);
    setRationale(null);
    setSelected((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));
  };

  const spin = async () => {
    if (spinning) return;
    const pool = await load();
    if (!pool.length) return;
    const result = pickWithRationale(pool, { tags: selected });
    setSpinning(true);
    setLanded(null);
    setRationale(null);
    setRotation((r) => r + 360 * 5 + Math.random() * 360);
    // Wheel rotation animates over 2.2s (CSS transition below). Sync the
    // text randomization to the same wall-clock duration, with easing so
    // it slows down toward the end. Stopping by elapsed time (not by a
    // fixed frame count) keeps the two in lockstep regardless of pool size.
    const SPIN_MS = 2200;
    const startedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    let i = 0;
    const tick = () => {
      setCycleIdx(i % pool.length);
      i++;
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsed = now - startedAt;
      if (elapsed >= SPIN_MS) {
        setSpinning(false);
        setLanded(result.dish);
        setRationale(result.rationale);
        return;
      }
      const progress = elapsed / SPIN_MS;
      // Fast at start (~35ms), slowing to ~235ms by the end.
      const delay = 35 + Math.pow(progress, 3) * 200;
      timerRef.current = window.setTimeout(tick, delay);
    };
    tick();
  };

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  const displayed = landed || dishes[cycleIdx] || dishes[0];
  const weekday = useMemo(() => new Date().toLocaleDateString(undefined, { weekday: "long" }), []);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <AppHeader />
      <div className="flex-1 overflow-auto pb-20">
       <div className="mx-auto w-full max-w-3xl">
        <div className="px-5 pt-2 pb-5">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
            Tonight · {weekday}
          </div>
          <h1 className="m-0 text-[40px] font-medium leading-[1.02] tracking-[-0.03em] text-ink" style={{ fontFamily: "var(--font-disp)" }}>
            What&rsquo;s for<br />
            <em className="italic text-accent">dinner?</em>
          </h1>
          <p className="mt-[6px] max-w-[280px] text-[13px] text-ink-2">
            {dishes.length} {dishes.length === 1 ? "dish" : "dishes"} in the pool.{" "}
            {selected.length ? `Filtered by ${selected.join(" + ")}.` : "Nothing ruled out."}
          </p>
        </div>

        <div className="flex flex-wrap gap-[6px] px-4 pb-2">
          {allTags.slice(0, 12).map((t) => (
            <Chip key={t} active={selected.includes(t)} onClick={() => toggleTag(t)}>{t}</Chip>
          ))}
        </div>

        <div className="relative mx-4 min-h-[360px] flex flex-col items-center pt-2">
          <WheelStage
            pool={dishes}
            displayed={displayed}
            spinning={spinning}
            landed={landed}
            rotation={rotation}
            onSpin={spin}
          />
          {landed && !spinning && (
            <LandedCard
              dish={landed}
              rationale={rationale}
              onDismiss={() => {
                setLanded(null);
                setRationale(null);
              }}
              onView={() => router.push(`/dishes/${landed.id}`)}
              onSpinAgain={spin}
            />
          )}
        </div>

        {!dishes.length && (
          <div className="mx-4 my-4 rounded-lg border border-dashed border-rule p-6 text-center text-[13px] text-ink-3">
            No dishes match the current filter.
          </div>
        )}
        <style>{`@keyframes revealUp { from { opacity: 0; transform: translateY(24px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
       </div>
      </div>
    </div>
  );
}

function wedgePath(i: number, n: number): string {
  // SVG wedge from center (50,50) on a circle of radius 50, starting from
  // the top and proceeding clockwise. Index 0 is the wedge anchored at 12 o'clock.
  if (n === 1) {
    // One slice = full circle, drawn as two half-arcs.
    return "M 50 0 A 50 50 0 1 1 50 100 A 50 50 0 1 1 50 0 Z";
  }
  const startRad = ((-90 + (i / n) * 360) * Math.PI) / 180;
  const endRad = ((-90 + ((i + 1) / n) * 360) * Math.PI) / 180;
  const sx = 50 + 50 * Math.cos(startRad);
  const sy = 50 + 50 * Math.sin(startRad);
  const ex = 50 + 50 * Math.cos(endRad);
  const ey = 50 + 50 * Math.sin(endRad);
  const largeArc = 1 / n > 0.5 ? 1 : 0;
  return `M 50 50 L ${sx} ${sy} A 50 50 0 ${largeArc} 1 ${ex} ${ey} Z`;
}

function WheelStage({ pool, displayed, spinning, landed, rotation, onSpin }: {
  pool: Dish[]; displayed?: Dish; spinning: boolean; landed: Dish | null; rotation: number; onSpin: () => void;
}) {
  const slices = pool.slice(0, 10);
  const n = Math.max(slices.length, 1);
  const sliceDeg = 360 / n;
  const size = "min(340px, calc(100vw - 80px))";
  const wheelTransform = `rotate(${rotation}deg)`;
  const wheelTransition = spinning
    ? "transform 2.2s cubic-bezier(0.15, 0.85, 0.2, 1)"
    : "transform 0.4s";
  return (
    <div
      className={[
        "relative flex flex-col items-center transition-[opacity,transform] duration-300",
        landed && !spinning ? "pointer-events-none scale-[0.92] opacity-25" : "",
      ].join(" ")}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <div
          className="absolute inset-0 rounded-full overflow-hidden border-4 border-paper shadow-[0_16px_40px_rgba(0,0,0,0.12)]"
          style={{ transform: wheelTransform, transition: wheelTransition }}
        >
          {slices.length ? (
            <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
              <defs>
                {slices.map((d, i) => (
                  <clipPath key={d.id} id={`wedge-clip-${d.id}`}>
                    <path d={wedgePath(i, n)} />
                  </clipPath>
                ))}
              </defs>
              {slices.map((d, i) => {
                const accent = d.accent || `oklch(${60 + (i % 3) * 8}% 0.12 ${(i * 37) % 360})`;
                return (
                  <g key={d.id} clipPath={`url(#wedge-clip-${d.id})`}>
                    <path d={wedgePath(i, n)} fill={accent} />
                    {d.imageUrl && (
                      <image
                        href={d.imageUrl}
                        x={0}
                        y={0}
                        width={100}
                        height={100}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    )}
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="absolute inset-0" style={{ background: "var(--bg-alt)" }} />
          )}
        </div>
        <div className="absolute inset-0" style={{ transform: wheelTransform, transition: wheelTransition }}>
          {slices.map((d, i) => {
            // Only show the emoji/letter label for dishes WITHOUT a photo —
            // the photo communicates the dish on its own and a label over a
            // photo gets visually noisy.
            if (d.imageUrl) return null;
            const midDeg = (i + 0.5) * sliceDeg - 90;
            const rad = (midDeg * Math.PI) / 180;
            const cx = 50 + Math.cos(rad) * 32;
            const cy = 50 + Math.sin(rad) * 32;
            const label = d.emoji || d.title.trim().charAt(0).toUpperCase() || "·";
            return (
              <div
                key={d.id}
                className="absolute flex h-9 w-9 items-center justify-center text-paper"
                style={{
                  left: `${cx}%`,
                  top: `${cy}%`,
                  transform: "translate(-50%, -50%)",
                  fontFamily: "var(--font-disp)", fontSize: 22, fontWeight: 600,
                  textShadow: "0 1px 2px rgba(0,0,0,0.35)",
                }}
              >
                {label}
              </div>
            );
          })}
        </div>
        <div
          className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1"
          style={{ borderLeft: "10px solid transparent", borderRight: "10px solid transparent", borderTop: "16px solid var(--ink)" }}
        />
        <button
          type="button"
          onClick={onSpin}
          className="absolute left-1/2 top-1/2 grid h-28 w-28 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-rule bg-paper text-ink shadow-[0_8px_20px_rgba(0,0,0,0.15)] disabled:opacity-60"
          disabled={spinning || !pool.length}
          aria-label="Spin"
        >
          <span className="text-center">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">
              {spinning ? "…" : "Tap"}
            </span>
            <span className="block text-[22px] font-medium" style={{ fontFamily: "var(--font-disp)" }}>
              {spinning ? "spinning" : "Spin"}
            </span>
          </span>
        </button>
      </div>
      {displayed && (
        <div className="mt-4 text-center">
          <div className="text-[11px] uppercase tracking-[0.14em] text-ink-3">Currently showing</div>
          <div className="text-[18px] font-medium text-ink" style={{ fontFamily: "var(--font-disp)" }}>{displayed.title}</div>
        </div>
      )}
    </div>
  );
}

function LandedCard({ dish, rationale, onDismiss, onView, onSpinAgain }: {
  dish: Dish; rationale: string | null; onDismiss: () => void; onView: () => void; onSpinAgain: () => void;
}) {
  return (
    <div
      className="absolute left-0 right-0 top-0 flex flex-col gap-3 rounded-lg border border-rule bg-paper p-[18px] shadow-[0_20px_40px_-8px_rgba(0,0,0,0.25),0_4px_12px_rgba(0,0,0,0.08)]"
      style={{ animation: "revealUp 0.45s cubic-bezier(0.2, 0.8, 0.2, 1)" }}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">✦ Tonight&rsquo;s pick</div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="p-1 text-lg leading-none text-ink-3">×</button>
      </div>
      <div className="flex items-center gap-[14px]">
        <DishArt dish={dish} size={76} />
        <div className="min-w-0 flex-1">
          <div className="text-[26px] font-medium leading-[1.05] tracking-[-0.02em] text-ink" style={{ fontFamily: "var(--font-disp)" }}>
            {dish.title}
          </div>
          {dish.subtitle && <div className="mt-[2px] text-[12px] italic text-ink-3">{dish.subtitle}</div>}
          {dish.tags?.length ? (
            <div className="mt-[6px] flex gap-[10px] text-[11px] text-ink-2" style={{ fontFamily: "var(--font-mono)" }}>
              <span>{dish.tags.slice(0, 3).join(" · ")}</span>
            </div>
          ) : null}
        </div>
      </div>
      {rationale && (
        <div
          className="text-[11px] leading-[1.4] text-ink-3"
          style={{ fontFamily: "var(--font-mono)" }}
          title="Why this one?"
        >
          {rationale}
        </div>
      )}
      <div className="mt-1 flex gap-2">
        <Button variant="primary" size="md" onClick={onView} className="flex-1">View recipe</Button>
        <Button variant="ghost" size="md" onClick={onSpinAgain} aria-label="Spin again"><Icon name="dice" size={16} /></Button>
      </div>
    </div>
  );
}
