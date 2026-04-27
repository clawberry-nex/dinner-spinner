// PWA install-prompt helpers. Pure logic extracted from the client
// component so it's unit-testable without a DOM — UA sniffing, dismissal
// persistence, and the "show this now?" decision live here.

const DISMISSED_KEY = "installPromptDismissed";

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

export function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {}
  // Also drop a long-lived cookie as a backup — some browsers/profiles
  // wipe localStorage between sessions but keep cookies, and we'd rather
  // err on the side of not nagging.
  try {
    if (typeof document !== "undefined") {
      const oneYear = 60 * 60 * 24 * 365;
      document.cookie = `${DISMISSED_KEY}=1; max-age=${oneYear}; path=/; samesite=lax`;
    }
  } catch {}
}

function readDismissedCookie(): boolean {
  try {
    if (typeof document === "undefined") return false;
    return document.cookie
      .split("; ")
      .some((c) => c.startsWith(`${DISMISSED_KEY}=1`));
  } catch {
    return false;
  }
}

export function shouldShowPrompt({ installed }: { installed: boolean }): boolean {
  if (installed) return false;
  if (readDismissed()) return false;
  if (readDismissedCookie()) return false;
  return true;
}
