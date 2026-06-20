"use client";

import type { CSSProperties } from "react";

// Editorial line-icon set. Single-path glyphs ported from the V2 prototype
// (components.jsx ICON_PATHS), plus a few aliases so pre-V2 surfaces keep
// rendering during the incremental rollout. A handful of icons that read
// better as multiple elements (filled star, cog, sun/moon, users, chef…) are
// special-cased below.
const PATHS = {
  // — V2 prototype set —
  decide:  "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4 M12 8a4 4 0 100 8 4 4 0 000-8z",
  library: "M4 5h7v14H4zM13 5h7v14h-7M7.5 8.5h0M16.5 8.5h0",
  plan:    "M4 7h16M4 7v12a1 1 0 001 1h14a1 1 0 001-1V7M4 7l2-3h12l2 3M9 11v6M15 11v6",
  profile: "M12 12a4 4 0 100-8 4 4 0 000 8zM5 20a7 7 0 0114 0",
  search:  "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4",
  plus:    "M12 5v14M5 12h14",
  heart:   "M12 20.5l-1.45-1.32C5.4 14.46 2 11.39 2 7.62 2 4.55 4.42 2.2 7.5 2.2c1.74 0 3.41.81 4.5 2.09 1.09-1.28 2.76-2.09 4.5-2.09C19.58 2.2 22 4.55 22 7.62c0 3.77-3.4 6.84-8.55 11.57L12 20.5z",
  star:    "M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z",
  clock:   "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  timer:   "M12 22a8 8 0 100-16 8 8 0 000 16zM12 6V2M9 2h6M12 14l3-3",
  flame:   "M12 22c4 0 6-3 6-6 0-4-4-5-3-10-3 1-5 4-5 7 0 0-2-1-2-3-1 2-2 3.5-2 6 0 3 2 6 6 6z",
  leaf:    "M5 19C5 9 13 5 20 5c0 9-5 14-12 14-2 0-3-1-3-3zM9 15c3-3 6-5 8-6",
  chevR:   "M9 6l6 6-6 6",
  chevL:   "M15 6l-6 6 6 6",
  chevD:   "M6 9l6 6 6-6",
  chevU:   "M6 15l6-6 6 6",
  close:   "M6 6l12 12M18 6L6 18",
  check:   "M5 12l5 5L19 6",
  arrowR:  "M5 12h14M13 6l6 6-6 6",
  minus:   "M5 12h14",
  reset:   "M4 12a8 8 0 108-8 8 8 0 00-6 2.7M4 4v3.7h3.7",
  edit:    "M4 20h4L18 10l-4-4L4 16zM14 6l4 4",
  camera:  "M4 8h3l1.5-2h7L17 8h3v11H4zM12 16a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
  sparkle: "M12 3l1.8 4.7L18 9l-4.2 1.3L12 15l-1.8-4.7L6 9l4.2-1.3zM18 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z",
  link:    "M10 14a4 4 0 005.7 0l2.3-2.3a4 4 0 00-5.7-5.7L11 7M14 10a4 4 0 00-5.7 0L6 12.3a4 4 0 005.7 5.7L13 17",
  share:   "M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6zM8.6 10.5L15.4 6.5M8.6 13.5L15.4 17.5",
  cart:    "M5 6h15l-1.5 9h-12zM5 6L4 3H2M8 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2z",
  list:    "M8 6h12M8 12h12M8 18h12M4 6h0M4 12h0M4 18h0",
  pin:     "M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11zM12 13a3 3 0 100-6 3 3 0 000 6z",
  bell:    "M6 16V10a6 6 0 1112 0v6l2 2H4zM10 20a2 2 0 004 0",
  back:    "M15 6l-6 6 6 6",
  dice:    "M5 5h14v14H5zM9 9h0M15 9h0M12 12h0M9 15h0M15 15h0",
  cards:   "M7 8h10v12H7zM9 5h9a1 1 0 011 1v9",
  shuffle: "M4 7h3l10 10h3M4 17h3l3-3M14 7h3M17 4l3 3-3 3M17 14l3 3-3 3",
  pantry:  "M4 8h16M6 8V5h12v3M5 8v11h14V8M9 12h6",
  todoist: "M5 12l4 4 10-10",
  dome:    "M3.5 18.5h17M5.5 18a6.5 6.5 0 0113 0M12 5.4V3.6M10.6 3.6h2.8",
  basket:  "M3 8.5h18l-1.6 9.2a1.6 1.6 0 01-1.6 1.3H6.2a1.6 1.6 0 01-1.6-1.3zM8.5 8.5l3-5M15.5 8.5l-3-5M9.5 12v3M14.5 12v3",
  books:   "M5 4.5h5.5v15H5zM13.5 4.5H19v15h-5.5M7 8h1.5M15.5 8H17",
  user2:   "M12 12.5a4 4 0 100-8 4 4 0 000 8zM4.5 20a7.5 7.5 0 0115 0",
  // — aliases keeping prior surfaces working —
  "chev-left":  "M15 6l-6 6 6 6",
  "chev-right": "M9 6l6 6-6 6",
  x:            "M6 6l12 12M18 6L6 18",
  filter:       "M4 6h16M7 12h10M10 18h4",
  pencil:       "M4 20l4-1 10-10-3-3L5 16l-1 4z M14 6l3 3",
  user:         "M12 12a4 4 0 100-8 4 4 0 000 8zM5 20a7 7 0 0114 0",
} as const;

type SpecialName =
  | "star-fill" | "gear" | "sun" | "moon" | "theme-auto" | "users" | "chef" | "ingredient";

export type IconName = keyof typeof PATHS | SpecialName;

type Props = {
  name: IconName;
  size?: number;
  stroke?: number;
  fill?: boolean;
  style?: CSSProperties;
  className?: string;
};

export function Icon({ name, size = 18, stroke = 1.7, fill = false, style, className }: Props) {
  const s = { width: size, height: size, display: "inline-block", flexShrink: 0, ...style } as CSSProperties;
  const c = "currentColor";
  switch (name) {
    case "star-fill":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill={c}><path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z"/></svg>;
    case "gear":
      // Cog with 8 teeth around a hub — distinct from the sun's radial spokes.
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round"><path d="M14.7 2.5l-.4 2.4a7.5 7.5 0 0 1 2 1.2l2.3-1 1.8 3-2 1.5a7.5 7.5 0 0 1 0 2.3l2 1.5-1.8 3-2.3-1a7.5 7.5 0 0 1-2 1.2l.4 2.4h-3.4l-.4-2.4a7.5 7.5 0 0 1-2-1.2l-2.3 1-1.8-3 2-1.5a7.5 7.5 0 0 1 0-2.3l-2-1.5 1.8-3 2.3 1a7.5 7.5 0 0 1 2-1.2l.4-2.4h3.4z"/><circle cx="12" cy="12" r="3"/></svg>;
    case "sun":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>;
    case "moon":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>;
    case "theme-auto":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 4v16"/><path d="M12 4a8 8 0 010 16z" fill={c} stroke="none"/></svg>;
    case "users":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="9" r="3"/><path d="M3 19a6 6 0 0112 0"/><circle cx="17" cy="7" r="2.5"/><path d="M15 14h.5a4.5 4.5 0 014.5 4.5"/></svg>;
    case "chef":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinejoin="round"><path d="M6 10a4 4 0 014-7 4 4 0 014 0 4 4 0 014 7v3H6v-3z"/><path d="M6 13h12v5a2 2 0 01-2 2H8a2 2 0 01-2-2v-5z"/></svg>;
    case "ingredient":
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round"><path d="M6 4h12l-2 15a2 2 0 01-2 2h-4a2 2 0 01-2-2L6 4z"/><path d="M9 4a3 3 0 016 0"/></svg>;
  }
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      style={s}
      className={className}
      fill={fill ? c : "none"}
      stroke={fill ? "none" : c}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}
