"use client";

import type { CSSProperties } from "react";

export type IconName =
  | "star" | "star-fill" | "check" | "plus" | "minus" | "x"
  | "chev-left" | "chev-right" | "search" | "timer" | "flame"
  | "list" | "cart" | "dice" | "gear" | "ingredient" | "chef"
  | "sun" | "moon";

type Props = { name: IconName; size?: number; style?: CSSProperties; className?: string };

export function Icon({ name, size = 18, style, className }: Props) {
  const s = { width: size, height: size, display: "inline-block", flexShrink: 0, ...style } as CSSProperties;
  const c = "currentColor";
  switch (name) {
    case "star":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7L12 3z"/></svg>;
    case "star-fill":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill={c}><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7L12 3z"/></svg>;
    case "check":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5 11-11"/></svg>;
    case "plus":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>;
    case "minus":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><path d="M5 12h14"/></svg>;
    case "x":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M6 18L18 6"/></svg>;
    case "chev-left":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7"/></svg>;
    case "chev-right":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7"/></svg>;
    case "search":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>;
    case "timer":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="7.5"/><path d="M12 13V9M9 3h6"/></svg>;
    case "flame":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinejoin="round"><path d="M12 3s4 4 4 8a4 4 0 01-8 0c0-2 1-3 1-3s-1 5 3 5c3 0 3-4 3-4-1 1-2 1-3-1z"/></svg>;
    case "list":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1" fill={c}/><circle cx="4" cy="12" r="1" fill={c}/><circle cx="4" cy="18" r="1" fill={c}/></svg>;
    case "cart":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h2l2.5 11h11l2-8H6"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>;
    case "dice":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.1" fill={c}/><circle cx="15" cy="15" r="1.1" fill={c}/><circle cx="15" cy="9" r="1.1" fill={c}/><circle cx="9" cy="15" r="1.1" fill={c}/></svg>;
    case "gear":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>;
    case "ingredient":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round"><path d="M6 4h12l-2 15a2 2 0 01-2 2h-4a2 2 0 01-2-2L6 4z"/><path d="M9 4a3 3 0 016 0"/></svg>;
    case "chef":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinejoin="round"><path d="M6 10a4 4 0 014-7 4 4 0 014 0 4 4 0 014 7v3H6v-3z"/><path d="M6 13h12v5a2 2 0 01-2 2H8a2 2 0 01-2-2v-5z"/></svg>;
    case "sun":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>;
    case "moon":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>;
  }
}
