export type TimerMatch = {
  start: number;
  end: number;
  label: string;
  seconds: number;
};

const TIMER_RE =
  /\b(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|h)\b/gi;

export function findTimers(text: string): TimerMatch[] {
  const out: TimerMatch[] = [];
  for (const m of text.matchAll(TIMER_RE)) {
    const qty = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    const isHour = unit === "h" || unit.startsWith("hour") || unit.startsWith("hr");
    const seconds = isHour ? Math.round(qty * 3600) : Math.round(qty * 60);
    const start = m.index ?? 0;
    out.push({
      start,
      end: start + m[0].length,
      label: m[0],
      seconds,
    });
  }
  return out;
}
