"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DishArt, Button } from "./_components/ui";
import { Icon, type IconName } from "./_components/icon";
import type { Dish } from "@/lib/types";
import { computeDietFlags, formatDietChips } from "@/lib/diet";
import { pickWithRationale, type WeightFactor } from "@/lib/spinner";

type Phase = "idle" | "spinning" | "result";

// How long the deceleration transition runs before we flip to the result
// phase. Kept just under the CSS transition so the frame-pop lands as the
// reel settles. Mobile / desktop share this — the few hundred ms of slack
// is imperceptible.
const SPIN_MS = 2650;

export default function SpinnerPage() {
  const router = useRouter();
  const [dishes, setDishes] = useState<Dish[]>([]);
  // True until the first /api/dishes fetch settles. Without it the page
  // renders the empty-kitchen state (dishes=[] on SSR + until the client
  // fetch lands) and then snaps to the reel — a jarring flash. We show a
  // skeleton reel instead, and only fall through to EmptyPool once we've
  // actually confirmed the pool is empty.
  const [loading, setLoading] = useState(true);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pick, setPick] = useState<Dish | null>(null);
  const [factors, setFactors] = useState<WeightFactor[]>([]);
  const [pickPoolSize, setPickPoolSize] = useState(0);
  const [spinSeed, setSpinSeed] = useState(0);
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
    try {
      const res = await fetch(`/api/dishes${qs}`);
      const data: Dish[] = await res.json();
      setDishes(data);
      return data;
    } catch {
      return [];
    } finally {
      // Clears the skeleton after the first fetch (and stays cleared — later
      // filter re-fetches keep the reel visible rather than flashing back).
      setLoading(false);
    }
  };

  // `load` is stable enough for this effect; re-creating it on every render
  // would cause an infinite loop. selected.join(",") is the real trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [selected.join(",")]);

  const reset = () => {
    setPhase("idle");
    setPick(null);
    setFactors([]);
  };

  const toggleTag = (t: string) => {
    reset();
    setSelected((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));
  };

  const spin = () => {
    if (phase === "spinning") return;
    if (!dishes.length) return;
    // Compute the pick FIRST so the reel can decelerate onto it.
    const result = pickWithRationale(dishes, { tags: selected });
    setPick(result.dish);
    setFactors(result.factors);
    setPickPoolSize(result.poolSize);
    setPhase("spinning");
    setSpinSeed((s) => s + 1);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setPhase("result"), SPIN_MS);
  };

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  const narrowed = selected.length > 0;
  const poolSize = dishes.length;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-24 lg:pb-10">
        <div className="mx-auto flex w-full max-w-5xl flex-col px-5 pt-[var(--safe-top)] lg:px-10">
          {/* Header section — no AppHeader; the shell owns the brand chrome. */}
          <div className="lg:mt-2">
            <div className="mb-[10px] text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              Dinner Spinner
            </div>
            <h1
              className="m-0 font-medium leading-[1.04] tracking-[-0.02em] text-text"
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: phase === "result" ? "clamp(22px,5vw,30px)" : "clamp(32px,7vw,46px)",
                transition: "font-size .3s ease",
              }}
            >
              {phase === "result" ? (
                "Tonight, make"
              ) : (
                <>
                  What&rsquo;s for<br className="lg:hidden" />{" "}
                  <em className="italic text-accent">dinner?</em>
                </>
              )}
            </h1>
            {phase !== "result" && (
              <div className="mt-2 text-[13.5px] text-text-dim lg:text-[15px]">
                {loading ? (
                  "Gathering your dishes…"
                ) : (
                  <>
                    {poolSize} {poolSize === 1 ? "dish" : "dishes"} in the running
                    {narrowed && " · narrowed"}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Inline tag-chip rail (the real /api/tags filter + persistence). */}
          {phase !== "result" && !loading && allTags.length > 0 && (
            <div className="-mx-1 mt-4 flex gap-[6px] overflow-x-auto px-1 pb-1 no-scrollbar lg:flex-wrap lg:overflow-visible">
              {allTags.slice(0, 14).map((t) => {
                const on = selected.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    className={[
                      "inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-pill border px-3 py-[6px] text-[13px] transition-colors",
                      on
                        ? "border-accent bg-accent text-accent-ink"
                        : "border-line-2 bg-transparent text-text-dim hover:border-text-faint",
                    ].join(" ")}
                    style={{ letterSpacing: 0.2 }}
                  >
                    {t}
                    {on && <Icon name="close" size={12} />}
                  </button>
                );
              })}
            </div>
          )}

          {loading ? (
            <LoadingStage />
          ) : poolSize === 0 ? (
            <EmptyPool
              narrowed={narrowed}
              onClear={() => { reset(); setSelected([]); }}
              onAdd={() => router.push("/add")}
            />
          ) : (
            <>
              {/* Reel stage. The Filmstrip is mounted continuously across
                  idle → spinning → result so its imperatively-set rest index
                  survives into the frozen result frame. During idle/spinning
                  it doubles as the desktop reel (sizes itself wide from its
                  measured width). At desktop *result* we hide this whole block
                  (lg:hidden) and show the hero two-column below instead; on
                  mobile it stays, frozen on the pick, with the detail stacked
                  beneath. */}
              <div className={phase === "result" ? "lg:hidden" : ""}>
                <div className="mt-6 flex flex-col lg:mt-10 lg:min-h-[46vh] lg:justify-center">
                  <Filmstrip
                    pool={dishes}
                    pick={pick}
                    phase={phase}
                    spinSeed={spinSeed}
                  />

                  {phase === "result" && pick ? (
                    <MobileResultDetail
                      dish={pick}
                      factors={factors}
                      poolSize={pickPoolSize}
                      narrowed={narrowed}
                      onAgain={spin}
                      onReset={reset}
                      onOpen={() => router.push(`/dishes/${pick.id}`)}
                    />
                  ) : (
                    <div className="mt-7 flex flex-col items-center gap-4 lg:mt-10">
                      <p className="text-center text-[13px] text-text-faint lg:text-[14px]">
                        {phase === "spinning"
                          ? "Letting the reel settle…"
                          : "Spin the reel — it lands on one, and tells you why."}
                      </p>
                      <Button
                        variant="primary"
                        onClick={spin}
                        disabled={phase === "spinning"}
                        className="h-14 w-full max-w-md text-[16.5px] lg:h-[58px] lg:w-auto lg:min-w-[260px] lg:px-9 lg:text-[17px]"
                      >
                        {phase === "spinning" ? (
                          <>
                            <SpinnerGlyph />Choosing…
                          </>
                        ) : (
                          <>
                            <Icon name="sparkle" size={20} style={{ color: "var(--accent-ink)" }} />
                            Spin the reel
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Desktop result hero — replaces the reel at lg on result. */}
              {phase === "result" && pick && (
                <DesktopResultHero
                  dish={pick}
                  factors={factors}
                  poolSize={pickPoolSize}
                  narrowed={narrowed}
                  onAgain={spin}
                  onReset={reset}
                  onOpen={() => router.push(`/dishes/${pick.id}`)}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Loading stage — a skeleton of the filmstrip shown while the first
// /api/dishes fetch is in flight. It mirrors the Filmstrip's geometry
// (depth band, a centered card scaled up between dimmed neighbours, edge
// fades, the dimmed focus frame) so when real cards arrive they resolve
// into the same layout with no jump — and the page never flashes the
// empty-kitchen state first. Measures its own width like the Filmstrip so
// the card box matches the wide/narrow breakpoint.
// ---------------------------------------------------------------
function LoadingStage() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(380);
  useEffect(() => {
    const measure = () => { if (ref.current) setW(ref.current.offsetWidth); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const wide = w >= 720;
  const CARD = wide ? 176 : 132;
  const CARDH = wide ? 222 : 168;
  const GAP = wide ? 22 : 16;
  const FRAME_W = CARD + 14;
  const FRAME_H = CARDH + 14;

  return (
    <div className="mt-6 flex flex-col lg:mt-10 lg:min-h-[46vh] lg:justify-center">
      <div ref={ref} className="relative" style={{ margin: "10px 0 0" }}>
        <div className="relative overflow-hidden" style={{ height: CARDH + 30 }}>
          {/* depth band */}
          <div
            className="pointer-events-none absolute left-0 right-0 top-1/2 z-0 -translate-y-1/2"
            style={{
              height: CARDH + 24,
              background: "radial-gradient(70% 120% at 50% 50%, var(--surface) 0%, transparent 72%)",
              opacity: 0.6,
            }}
          />
          {/* placeholder cards: centre scaled up, neighbours dimmed — matches the reel */}
          <div
            className="absolute left-1/2 top-1/2 z-[1] flex -translate-x-1/2 -translate-y-1/2"
            style={{ gap: GAP }}
          >
            {[-2, -1, 0, 1, 2].map((s) => {
              const center = s === 0;
              return (
                <div
                  key={s}
                  className="relative shrink-0 overflow-hidden rounded-[12px] border border-line-2"
                  style={{
                    width: CARD,
                    height: CARDH,
                    transform: center ? "scale(1.02)" : "scale(0.88)",
                    opacity: center ? 1 : 0.5,
                    background: "var(--surface-2)",
                  }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(100deg, transparent 25%, rgba(255,255,255,0.07) 50%, transparent 75%)",
                      backgroundSize: "220% 100%",
                      animation: "ds-shimmer 1.5s linear infinite",
                    }}
                  />
                </div>
              );
            })}
          </div>
          {/* edge fades */}
          <div
            className="pointer-events-none absolute inset-0 z-[3]"
            style={{
              background:
                "linear-gradient(90deg, var(--bg) 0%, transparent 20%, transparent 80%, var(--bg) 100%)",
            }}
          />
        </div>
        {/* dimmed focus frame, centred like the live one */}
        <div className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center">
          <svg
            width={FRAME_W}
            height={FRAME_H + 16}
            viewBox={`0 0 ${FRAME_W} ${FRAME_H + 16}`}
            fill="none"
            style={{ overflow: "visible", opacity: 0.55 }}
          >
            <rect x={1} y={8} width={FRAME_W - 2} height={FRAME_H} rx={14} ry={14} stroke="var(--accent)" strokeWidth={2} />
            <rect x={FRAME_W / 2 - 5.5} y={2.5} width={11} height={11} rx={2} fill="var(--accent)" transform={`rotate(45 ${FRAME_W / 2} 8)`} />
            <rect x={FRAME_W / 2 - 5.5} y={8 + FRAME_H - 5.5} width={11} height={11} rx={2} fill="var(--accent)" transform={`rotate(45 ${FRAME_W / 2} ${8 + FRAME_H})`} />
          </svg>
        </div>
      </div>
      {/* placeholder for the spin button, holding the layout height */}
      <div className="mt-7 flex justify-center lg:mt-10">
        <div
          className="h-14 w-full max-w-md rounded-pill lg:h-[58px] lg:w-[260px]"
          style={{ background: "var(--surface-2)", opacity: 0.5 }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// The filmstrip — a reel of real dish cards streaming past a focus
// frame, decelerating onto the pre-computed pick. Imperative animation
// via refs + inline style, ported from the prototype. Responsive: it
// measures its own width and scales the card box up on wide layouts.
// ---------------------------------------------------------------
function Filmstrip({
  pool,
  pick,
  phase,
  spinSeed,
}: {
  pool: Dish[];
  pick: Dish | null;
  phase: Phase;
  spinSeed: number;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(380);

  useEffect(() => {
    const measure = () => { if (wrapRef.current) setW(wrapRef.current.offsetWidth); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Wider layouts (desktop / tablet) get larger cards and more breathing room.
  const wide = w >= 720;
  const CARD = wide ? 176 : 132;
  const CARDH = wide ? 222 : 168;
  const GAP = wide ? 22 : 16;
  const STEP = CARD + GAP;
  const EMOJI = wide ? 84 : 66;

  // A long reel: the pool repeated, so there's a lot to stream past.
  const LOOPS = 7;
  const reel = useMemo(() => {
    const out: Dish[] = [];
    for (let i = 0; i < LOOPS; i++) out.push(...pool);
    return out;
  }, [pool]);

  const centerOffset = w / 2 - CARD / 2;
  const restIndexRef = useRef(Math.min(2, Math.max(0, pool.length - 1)));

  // Run the spin animation whenever a new spinSeed arrives with a pick.
  useEffect(() => {
    if (phase !== "spinning" || !pick || !trackRef.current || !wrapRef.current) return;
    const track = trackRef.current;
    // Measure fresh: the wrap may have been display:none (e.g. behind the
    // desktop hero) when `w` was last captured, which would zero the math.
    const liveW = wrapRef.current.offsetWidth || w;
    if (liveW !== w) setW(liveW);
    const liveCenter = liveW / 2 - CARD / 2;
    const pickIdx = pool.findIndex((d) => d.id === pick.id);
    // Land on an occurrence of the pick deep in the reel (loop LOOPS-2).
    const landLoop = LOOPS - 2;
    let landIdx = landLoop * pool.length + pickIdx;
    if (pickIdx < 0) landIdx = landLoop * pool.length;
    restIndexRef.current = landIdx;
    const targetX = liveCenter - landIdx * STEP;
    // Reset near the start (equivalent visual frame), no transition.
    const startIdx = 1 * pool.length + (pickIdx >= 0 ? pickIdx % pool.length : 0);
    const startX = liveCenter - startIdx * STEP;
    track.style.transition = "none";
    track.style.transform = `translateX(${startX}px)`;
    track.style.filter = "blur(0px)";
    void track.offsetWidth; // reflow
    requestAnimationFrame(() => {
      track.style.transition = "transform 2.7s cubic-bezier(.08,.66,.1,1), filter 2.7s ease";
      track.style.transform = `translateX(${targetX}px)`;
      // Motion blur swells then clears mid-spin so the reel reads as speed. Safe
      // again now that the focus frame is its own flex-centered layer with a
      // scale-only pop — the old frame break-up was its centering fighting its
      // transform, never this blur.
      track.style.filter = "blur(3px)";
    });
    const clearBlur = window.setTimeout(() => {
      if (trackRef.current) trackRef.current.style.filter = "blur(0px)";
    }, 1800);
    return () => window.clearTimeout(clearBlur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinSeed]);

  // When the pool itself changes (a filter narrowed/widened the set) and we're
  // not mid-spin, drop back to a default rest frame and clear any imperatively
  // set transform/filter so the declarative idle position re-applies cleanly.
  // Guards against a stale rest index pointing past the rebuilt reel.
  const poolKey = pool.map((d) => d.id).join(",");
  useEffect(() => {
    if (phase === "spinning") return;
    restIndexRef.current = Math.min(2, Math.max(0, pool.length - 1));
    const track = trackRef.current;
    if (track) {
      track.style.transition = "none";
      track.style.filter = "blur(0px)";
      track.style.transform = `translateX(${w / 2 - CARD / 2 - restIndexRef.current * STEP}px)`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey]);

  // Resting position when idle / result (centered on the current rest index).
  const idleX = centerOffset - restIndexRef.current * STEP;
  const FRAME_W = CARD + 14;
  const FRAME_H = CARDH + 14;

  return (
    <div className="relative" style={{ margin: "10px 0 0" }}>
    <div
      ref={wrapRef}
      className="relative overflow-hidden"
      style={{ height: phase === "result" ? CARDH + 22 : CARDH + 30 }}
    >
      {/* depth band behind the reel */}
      <div
        className="pointer-events-none absolute left-0 right-0 top-1/2 z-0 -translate-y-1/2"
        style={{
          height: CARDH + 24,
          background: "radial-gradient(70% 120% at 50% 50%, var(--surface) 0%, transparent 72%)",
          opacity: 0.6,
        }}
      />

      {/* the track */}
      <div
        ref={trackRef}
        className="absolute left-0 top-1/2 z-[1] flex"
        style={{
          gap: GAP,
          transform: `translateX(${idleX}px)`,
          marginTop: -(CARDH / 2),
          willChange: "transform, filter",
        }}
      >
        {reel.map((d, i) => {
          const centered = phase !== "spinning" && i === restIndexRef.current;
          const dimNeighbor = phase === "result" ? 0.34 : 0.52;
          return (
            <div
              key={i}
              className="relative shrink-0 overflow-hidden"
              style={{
                width: CARD,
                height: CARDH,
                borderRadius: 12,
                border: "1px solid var(--line-2)",
                transform: centered ? "scale(1.02)" : "scale(0.88)",
                opacity: centered ? 1 : phase === "spinning" ? 0.78 : dimNeighbor,
                boxShadow: centered ? "0 18px 40px -12px rgba(0,0,0,0.6)" : "none",
                transition:
                  "transform .42s cubic-bezier(.2,.7,.2,1), opacity .42s ease, box-shadow .42s ease",
              }}
            >
              <DishArt dish={d} fill emojiSize={EMOJI} />
              {/* legibility scrim + title on wide cards */}
              {wide && (
                <>
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{ background: "linear-gradient(180deg, transparent 55%, rgba(15,11,8,0.72) 100%)" }}
                  />
                  <div
                    className="absolute bottom-[11px] left-3 right-3 line-clamp-2 text-[14px] font-semibold leading-[1.15] text-white"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {d.title}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* edge fades */}
      <div
        className="pointer-events-none absolute inset-0 z-[3]"
        style={{
          background:
            "linear-gradient(90deg, var(--bg) 0%, transparent 20%, transparent 80%, var(--bg) 100%)",
        }}
      />

      {/* (edge fades above close out the reel viewport) */}
      </div>

      {/* Center focus frame — an inline SVG over the reel, centered by a flex
          overlay rather than top:50%+translate. That percentage-centering fought
          the settle pop: while ds-framepop animated `transform`, the frame's
          `top:50%` re-resolved and the whole frame jumped ~half its own height
          up for the animation's ~0.55s, then snapped back — the orange-stroke
          "break up, then resolve" flash on spin→result. Flex centering keeps the
          transform free for a pure-scale pop, so position and animation can't
          conflict. The overlay shares the reel viewport's exact box (its sibling
          above), so the frame stays locked on the centered card through the
          reflow; sitting outside the overflow:hidden wrap keeps the ticks and the
          1.05 pop from being clipped. SVG stroke (not a CSS border) also dodges
          the mobile-GPU border-shatter. */}
      <div className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center">
        <svg
          width={FRAME_W}
          height={FRAME_H + 16}
          viewBox={`0 0 ${FRAME_W} ${FRAME_H + 16}`}
          fill="none"
          style={{
            overflow: "visible",
            animation: phase === "result" ? "ds-framepop .55s cubic-bezier(.2,.8,.2,1)" : "none",
          }}
        >
          <rect x={1} y={8} width={FRAME_W - 2} height={FRAME_H} rx={14} ry={14} stroke="var(--accent)" strokeWidth={2} />
          <rect x={FRAME_W / 2 - 5.5} y={2.5} width={11} height={11} rx={2} fill="var(--accent)" transform={`rotate(45 ${FRAME_W / 2} 8)`} />
          <rect x={FRAME_W / 2 - 5.5} y={8 + FRAME_H - 5.5} width={11} height={11} rx={2} fill="var(--accent)" transform={`rotate(45 ${FRAME_W / 2} ${8 + FRAME_H})`} />
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Mobile result detail — sits BELOW the persistent (frozen) filmstrip,
// so it carries no reel of its own. Title + reasons + actions stacked.
// ---------------------------------------------------------------
function MobileResultDetail({
  dish,
  factors,
  poolSize,
  narrowed,
  onAgain,
  onReset,
  onOpen,
}: {
  dish: Dish;
  factors: WeightFactor[];
  poolSize: number;
  narrowed: boolean;
  onAgain: () => void;
  onReset: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="mx-auto mt-3 w-full max-w-md">
      <div className="text-center" style={{ animation: "ds-rise .45s cubic-bezier(.2,.7,.2,1) both" }}>
        <h2
          className="m-0 text-[24px] font-semibold leading-[1.1] tracking-[-0.01em] text-text"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {dish.title}
        </h2>
        {dish.subtitle && <div className="mt-1 text-[13.5px] text-text-dim">{dish.subtitle}</div>}
        <DietChips dish={dish} className="mt-[9px] justify-center" />
      </div>

      <div
        className="mt-[13px] rounded-[var(--radius-lg)] border border-line bg-surface p-[13px_16px] shadow-[var(--shadow-card)]"
        style={{ animation: "ds-rise .45s cubic-bezier(.2,.7,.2,1) both" }}
      >
        <div className="mb-[10px] text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
          Why this one · from {poolSize} {narrowed ? "matching" : "dishes"}
        </div>
        <ReasonRows factors={factors} />
      </div>

      <div className="mt-[13px] flex gap-[10px]">
        <Button variant="ghost" onClick={onAgain} className="shrink-0 px-[18px]">
          <Icon name="shuffle" size={18} />Again
        </Button>
        <Button variant="primary" onClick={onOpen} className="flex-1">
          Open recipe<Icon name="arrowR" size={18} style={{ color: "var(--accent-ink)" }} />
        </Button>
      </div>
      <div className="mt-[11px] text-center">
        <button
          type="button"
          onClick={onReset}
          className="p-1 text-[13.5px] font-semibold text-text-faint"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          Not tonight
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Desktop result hero — a two-column hero shown at ≥lg on result: big art
// on the left, title + reasons + actions on the right.
// ---------------------------------------------------------------
function DesktopResultHero({
  dish,
  factors,
  poolSize,
  narrowed,
  onAgain,
  onReset,
  onOpen,
}: {
  dish: Dish;
  factors: WeightFactor[];
  poolSize: number;
  narrowed: boolean;
  onAgain: () => void;
  onReset: () => void;
  onOpen: () => void;
}) {
  return (
      <div
        className="mt-8 hidden gap-11 lg:grid"
        style={{ gridTemplateColumns: "minmax(320px, 440px) 1fr", alignItems: "start" }}
      >
        <button
          type="button"
          onClick={onOpen}
          className="relative block w-full overflow-hidden rounded-[var(--radius-xl)] shadow-[var(--shadow-pop)]"
          style={{ aspectRatio: "0.92", animation: "ds-rise .5s cubic-bezier(.2,.7,.2,1) both" }}
        >
          <DishArt dish={dish} fill emojiSize={130} />
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "linear-gradient(180deg, transparent 60%, rgba(15,11,8,0.55) 100%)" }}
          />
          {dish.tags?.length ? (
            <div className="absolute bottom-4 left-[18px] flex flex-wrap gap-2">
              {dish.tags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="rounded-pill px-[11px] py-[5px] text-[12px] font-semibold text-white"
                  style={{ background: "rgba(20,14,11,0.5)", backdropFilter: "blur(8px)" }}
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </button>

        <div style={{ animation: "ds-rise .5s cubic-bezier(.2,.7,.2,1) both", animationDelay: ".08s" }}>
          <h2
            className="m-0 text-[38px] font-semibold leading-[1.06] tracking-[-0.015em] text-text"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {dish.title}
          </h2>
          {dish.subtitle && (
            <div className="mt-[10px] max-w-[560px] text-[16px] leading-[1.45] text-text-dim">
              {dish.subtitle}
            </div>
          )}
          <DietChips dish={dish} className="mt-4" />

          <div className="mt-6 max-w-[560px] rounded-[var(--radius-lg)] border border-line bg-surface p-[18px_22px] shadow-[var(--shadow-card)]">
            <div className="mb-[6px] text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              Why this one · from {poolSize} {narrowed ? "matching" : "dishes"}
            </div>
            <ReasonRows factors={factors} desktop />
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="primary" onClick={onOpen} className="px-[26px]">
              Open recipe<Icon name="arrowR" size={18} style={{ color: "var(--accent-ink)" }} />
            </Button>
            <Button variant="ghost" onClick={onAgain}>
              <Icon name="shuffle" size={18} />Again
            </Button>
            <button
              type="button"
              onClick={onReset}
              className="px-2 text-[14px] font-medium text-text-faint"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              Not tonight
            </button>
          </div>
        </div>
      </div>
  );
}

// ---------------------------------------------------------------
// Reason rows — maps the real weight factors to icon + signal display.
// ---------------------------------------------------------------
type FactorDisplay = {
  icon: IconName;
  color: string;
  fill: boolean;
  text: string;
  dir: "up" | "down" | "flat";
  strong: boolean;
};

// Title-case a factor label while preserving symbols/numbers (e.g.
// "rated 4.5★" → "Rated 4.5★", "cooked 3 days ago" → "Cooked 3 Days Ago").
function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function describeFactor(f: WeightFactor): FactorDisplay {
  const dir: FactorDisplay["dir"] = f.multiplier > 1 ? "up" : f.multiplier < 1 ? "down" : "flat";
  const up = dir === "up";
  const strong = f.multiplier >= 2 || f.multiplier <= 0.4;
  const label = f.label.toLowerCase();

  let icon: IconName = "sparkle";
  let color = "var(--text-dim)";
  let fill = false;

  if (label.includes("★") || label.includes("rated")) {
    icon = "star";
    color = up ? "var(--gold)" : "var(--text-faint)";
    fill = true;
  } else if (label.includes("favourite") || label.includes("favorite")) {
    icon = "heart";
    color = "var(--rose)";
    fill = true;
  } else if (label.includes("cooked")) {
    icon = "clock";
    color = up ? "var(--sage)" : "var(--text-faint)";
  }

  return { icon, color, fill, text: titleCase(f.label), dir, strong };
}

function signalGlyph(dir: FactorDisplay["dir"], strong: boolean): string {
  if (dir === "up") return strong ? "▲▲" : "▲";
  if (dir === "down") return strong ? "▼▼" : "▼";
  return "—";
}

function ReasonRows({ factors, desktop }: { factors: WeightFactor[]; desktop?: boolean }) {
  if (factors.length === 0) {
    return (
      <div className="flex items-center gap-[11px]">
        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] bg-surface-2">
          <Icon name="sparkle" size={14} style={{ color: "var(--text-dim)" }} />
        </span>
        <span className="flex-1 text-[14px] text-text">A fair shot from the pool</span>
        <span className="text-[12px] font-semibold text-text-faint">—</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col" style={desktop ? undefined : { gap: 10 }}>
      {factors.map((f, i) => {
        const m = describeFactor(f);
        return (
          <div
            key={i}
            className={[
              "flex items-center",
              desktop ? "gap-[13px] py-[11px]" : "gap-[11px]",
            ].join(" ")}
            style={
              desktop && i < factors.length - 1
                ? { borderBottom: "1px solid var(--line)" }
                : undefined
            }
          >
            <span
              className={[
                "flex shrink-0 items-center justify-center rounded-[8px] bg-surface-2",
                desktop ? "h-[30px] w-[30px] rounded-[9px]" : "h-[26px] w-[26px]",
              ].join(" ")}
            >
              <Icon name={m.icon} size={desktop ? 15 : 14} fill={m.fill} style={{ color: m.color }} />
            </span>
            <span className={["flex-1 text-text", desktop ? "text-[14.5px]" : "text-[14px]"].join(" ")}>
              {m.text}
            </span>
            <span
              className="font-semibold"
              style={{
                fontSize: desktop ? 13 : 12,
                color: m.dir === "up" ? "var(--sage)" : "var(--text-faint)",
              }}
            >
              {signalGlyph(m.dir, m.strong)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------
// Diet chips — derived from ingredients via lib/diet (no persistence).
// ---------------------------------------------------------------
function DietChips({ dish, className }: { dish: Dish; className?: string }) {
  const chips = useMemo(() => formatDietChips(computeDietFlags(dish.ingredients)), [dish.ingredients]);
  if (!chips.length) return null;
  return (
    <div className={["flex flex-wrap gap-[6px]", className ?? ""].join(" ")}>
      {chips.map((c) => (
        <span
          key={c.label}
          className="inline-flex items-center gap-[5px] rounded-pill border px-[10px] py-[3px] text-[11.5px] font-medium"
          style={{
            color: c.tone === "good" ? "var(--sage)" : "var(--rose)",
            borderColor: c.tone === "good" ? "var(--sage-tint)" : "var(--rose-tint)",
            background: c.tone === "good" ? "var(--sage-tint)" : "var(--rose-tint)",
          }}
        >
          {c.tone === "good" && <Icon name="leaf" size={12} />}
          {c.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------
function SpinnerGlyph() {
  return (
    <span
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        border: "2.5px solid rgba(42,20,10,0.3)",
        borderTopColor: "var(--accent-ink)",
        display: "inline-block",
        animation: "ds-spin .7s linear infinite",
      }}
    />
  );
}

function EmptyPool({
  narrowed,
  onClear,
  onAdd,
}: {
  narrowed: boolean;
  onClear: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center lg:py-20">
      <div className="text-[56px] opacity-50 lg:text-[64px]">🍽️</div>
      <h2
        className="mt-4 text-[22px] font-medium text-text lg:text-[26px]"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {narrowed ? "Nothing matches" : "Your kitchen’s empty"}
      </h2>
      <p className="mt-2 max-w-sm text-[14px] leading-[1.5] text-text-dim lg:text-[15px]">
        {narrowed
          ? "No dish fits all of those filters. Loosen them and try again."
          : "Add your first recipe and the spinner will start suggesting dinners."}
      </p>
      {narrowed ? (
        <Button variant="ghost" onClick={onClear} className="mt-[18px]">
          Clear filters
        </Button>
      ) : (
        <Button variant="primary" onClick={onAdd} className="mt-[18px]">
          <Icon name="sparkle" size={18} style={{ color: "var(--accent-ink)" }} />
          Add a recipe
        </Button>
      )}
    </div>
  );
}
