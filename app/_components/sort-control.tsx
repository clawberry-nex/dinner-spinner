"use client";

import { Icon } from "./icon";
import type { SortKey, SortOption } from "@/lib/dish-sort";

// Sort control — a native <select> styled to the design tokens. Native keeps it
// keyboard- and mobile-accessible for free (and opens the OS picker on touch).
// The funnel icon signals "sort"; a chevron hints the dropdown. Shared by the
// profile grid (/u/[handle]) and the Library page (/dishes).
export function SortControl({
  value,
  options,
  onChange,
}: {
  value: SortKey;
  options: SortOption[];
  onChange: (key: SortKey) => void;
}) {
  return (
    <label className="relative inline-flex shrink-0 items-center rounded-pill border border-line bg-surface text-text-dim transition-colors hover:border-line-2 focus-within:border-accent">
      <Icon
        name="filter"
        size={14}
        className="pointer-events-none absolute left-[12px]"
        style={{ color: "var(--text-faint)" }}
      />
      <span className="sr-only">Sort dishes</span>
      <select
        aria-label="Sort dishes"
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
        className="cursor-pointer appearance-none rounded-pill bg-transparent py-[8px] pl-[32px] pr-[30px] text-[12.5px] font-semibold text-text focus:outline-none"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon
        name="chevD"
        size={14}
        className="pointer-events-none absolute right-[11px]"
        style={{ color: "var(--text-faint)" }}
      />
    </label>
  );
}
