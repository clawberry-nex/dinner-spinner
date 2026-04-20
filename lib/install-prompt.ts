// PWA install-prompt helpers. Pure logic extracted from the client
// component so it's unit-testable without a DOM — UA sniffing, dismissal
// persistence, and the "show this now?" decision live here.

const DISMISSED_KEY = "installPromptDismissedAt";
const DISMISS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function isIOS(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  // iPadOS 13+ reports as Macintosh; distinguish via touch support.
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return true;
  return false;
}

type DisplayModeMatch = { matches: boolean } | null | undefined;

export function isStandalone(
  standaloneMatch: DisplayModeMatch,
  iosStandalone: boolean | undefined,
): boolean {
  if (standaloneMatch?.matches) return true;
  if (iosStandalone) return true;
  return false;
}

export function readDismissed(): number | null {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeDismissed(at: number): void {
  try {
    localStorage.setItem(DISMISSED_KEY, String(at));
  } catch {}
}

export function shouldShowPrompt({
  installed,
  now,
}: {
  installed: boolean;
  now: number;
}): boolean {
  if (installed) return false;
  const dismissedAt = readDismissed();
  if (dismissedAt === null) return true;
  return now - dismissedAt > DISMISS_COOLDOWN_MS;
}
