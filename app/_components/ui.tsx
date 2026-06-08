"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useState } from "react";
import { Icon } from "./icon";

type ChipProps = { active?: boolean; onClick?: () => void; children: ReactNode; size?: "sm" | "md" };
export function Chip({ active, onClick, children, size = "md" }: ChipProps) {
  const pads = size === "sm" ? "px-2 py-[3px] text-[11px]" : "px-3 py-[6px] text-[13px]";
  const cls = [
    "inline-flex items-center rounded-pill border whitespace-nowrap transition-colors",
    pads,
    active
      ? "border-accent bg-accent text-accent-ink"
      : "border-line bg-transparent text-text-dim hover:border-text-faint",
  ].join(" ");
  return (
    <button type="button" onClick={onClick} className={cls} style={{ letterSpacing: 0.2 }}>
      {children}
    </button>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-sm bg-bg-deep px-[6px] py-[2px] text-[9px] font-semibold uppercase tracking-[0.1em] text-text-faint">
      {children}
    </span>
  );
}

// Five-star rating display with partial fill on the active star. Ported from
// the V2 prototype's `Stars` atom: gold filled stars over a dim track. Purely
// presentational — pass `value` (0–5, fractional OK).
export function Stars({ value = 0, size = 14, gap = 1 }: { value?: number; size?: number; gap?: number }) {
  return (
    <span className="inline-flex" style={{ gap }}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fillPct = Math.max(0, Math.min(1, value - (i - 1))) * 100;
        return (
          <span key={i} style={{ position: "relative", width: size, height: size, display: "inline-block" }}>
            <Icon name="star" size={size} fill style={{ position: "absolute", inset: 0, color: "var(--gold)", opacity: 0.25 }} />
            <span style={{ position: "absolute", inset: 0, width: `${fillPct}%`, overflow: "hidden" }}>
              <Icon name="star" size={size} fill style={{ color: "var(--gold)" }} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

type ButtonProps = {
  variant?: "primary" | "ghost" | "ink" | "link";
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
};
export function Button({ variant = "primary", size = "md", onClick, type = "button", disabled, children, className, ...rest }: ButtonProps) {
  const sizes = {
    sm: "px-3 py-2 text-[12px]",
    md: "px-4 py-3 text-[14px]",
    lg: "px-5 py-[14px] text-[15px]",
  }[size];
  const variants = {
    primary: "bg-accent text-accent-ink border border-accent",
    ghost:   "bg-transparent text-text border border-line hover:border-text-faint",
    ink:     "bg-text text-surface border border-text",
    link:    "bg-transparent text-text-dim border-0 underline-offset-4 hover:underline",
  }[variant];
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={rest["aria-label"]}
      className={["inline-flex items-center justify-center gap-2 rounded-pill font-medium transition-opacity disabled:opacity-50", sizes, variants, className ?? ""].join(" ")}
      style={{ letterSpacing: 0.2 }}
    >
      {children}
    </button>
  );
}

export function StepperButton({ kind, onClick, ariaLabel }: { kind: "plus" | "minus"; onClick: () => void; ariaLabel: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="grid h-9 w-9 place-items-center rounded-pill border border-line bg-bg text-text hover:border-text-faint"
    >
      <Icon name={kind} size={16} />
    </button>
  );
}

// Servings stepper — ported from the V2 prototype (components.jsx). −/＋ around
// a serif numeral with a "servings" eyebrow; a reset-to-base chip appears when
// the count has deviated from `base`. Clamping to ≥1 is the caller's job
// (pass an onChange that floors at 1). `big` enlarges for the hero/action bar.
export function ServingsStepper({
  value,
  base,
  onChange,
  onReset,
  big = false,
}: {
  value: number;
  base: number;
  onChange: (next: number) => void;
  onReset?: () => void;
  big?: boolean;
}) {
  const deviated = value !== base;
  const sz = big ? "h-11 w-11" : "h-[34px] w-[34px]";
  return (
    <div className="flex items-center" style={{ gap: big ? 14 : 10 }}>
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        aria-label="Fewer servings"
        className={`grid ${sz} place-items-center rounded-pill border-0 bg-surface-2 text-text transition-colors hover:bg-surface-3`}
      >
        <Icon name="minus" size={big ? 20 : 16} />
      </button>
      <div className="text-center" style={{ minWidth: big ? 64 : 48 }}>
        <div
          className="tnum font-medium leading-none text-text"
          style={{ fontFamily: "var(--font-serif)", fontSize: big ? 32 : 22 }}
        >
          {value}
        </div>
        <div className="mt-[3px] text-[9px] font-semibold uppercase tracking-[0.18em] text-text-faint" style={{ fontFamily: "var(--font-sans)" }}>
          serving{value > 1 ? "s" : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        aria-label="More servings"
        className={`grid ${sz} place-items-center rounded-pill border-0 bg-surface-2 text-text transition-colors hover:bg-surface-3`}
      >
        <Icon name="plus" size={big ? 20 : 16} />
      </button>
      {deviated && onReset && (
        <button
          type="button"
          onClick={onReset}
          className="ml-[2px] inline-flex items-center gap-[6px] rounded-pill bg-surface-2 px-[11px] py-[6px] text-[12.5px] font-medium text-text-dim transition-colors hover:bg-surface-3"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          <Icon name="reset" size={13} />base {base}
        </button>
      )}
    </div>
  );
}

type DishArtDish = { emoji?: string | null; accent?: string | null; imageUrl?: string | null };
export function DishArt({
  dish,
  size = 64,
  corner = "var(--radius-md)",
  className,
  fill = false,
  emojiSize,
}: {
  dish: DishArtDish | null;
  size?: number | string;
  corner?: string;
  className?: string;
  // When true, the art fills its positioned parent (100%×100%) instead of
  // imposing its own box. Lets callers control the frame (e.g. portrait
  // filmstrip cards) while DishArt still owns the photo-vs-placeholder logic.
  fill?: boolean;
  // Explicit emoji glyph size for the placeholder; defaults to a fraction of
  // a numeric `size`, or 64 otherwise.
  emojiSize?: number;
}) {
  const accent = dish?.accent || "oklch(70% 0.14 40)";
  const style: CSSProperties = fill
    ? {
        position: "absolute", inset: 0, width: "100%", height: "100%",
        overflow: "hidden",
        background: `linear-gradient(135deg, ${accent}, oklch(from ${accent} calc(l + 0.1) c calc(h - 20)))`,
      }
    : {
        width: size, height: typeof size === "number" ? size : "auto",
        aspectRatio: typeof size === "string" ? "16/10" : undefined,
        borderRadius: corner, overflow: "hidden", position: "relative",
        background: `linear-gradient(135deg, ${accent}, oklch(from ${accent} calc(l + 0.1) c calc(h - 20)))`,
        flexShrink: 0,
      };
  const iconSize = emojiSize ?? (typeof size === "number" ? size * 0.42 : 64);
  if (dish?.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={dish.imageUrl} alt="" className={className} style={{ ...style, objectFit: "cover" }} />;
  }
  return (
    <div className={className} style={style}>
      <span style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: iconSize,
      }}>{dish?.emoji || "🍽️"}</span>
      <span style={{
        position: "absolute", inset: 0,
        background: "repeating-linear-gradient(45deg, transparent 0 3px, rgba(255,255,255,0.06) 3px 4px)",
        pointerEvents: "none",
      }} />
    </div>
  );
}

export function BrandMark({ size = 28, spinning = false }: { size?: number; spinning?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/logo-mark.svg"
      alt="Dinner Spinner"
      width={size}
      height={size}
      className="shrink-0 select-none"
      draggable={false}
      style={{
        transition: "transform 0.5s cubic-bezier(.2,.7,.2,1)",
        transform: spinning ? "rotate(360deg)" : "none",
      }}
    />
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((text: string) => {
    setMsg(text);
    window.setTimeout(() => setMsg(null), 2000);
  }, []);
  const el = msg ? (
    <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-pill bg-text px-4 py-[10px] text-[13px] font-medium text-surface shadow-[0_8px_24px_rgba(0,0,0,0.2)]">
      {msg}
    </div>
  ) : null;
  return { show, el };
}
