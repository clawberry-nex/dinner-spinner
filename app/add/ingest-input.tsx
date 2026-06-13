"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { compressImage, type CompressedImage } from "@/lib/image-compress";
import type { Dish, DishInput } from "@/lib/types";
import { buildSharePrefillFromSearch } from "@/lib/share-prefill";
import { isRecipeUrl } from "@/lib/ingest/scrape-url";
import { Icon, type IconName } from "../_components/icon";

// Ordered phases for the working-overlay timeline. These map the real
// agent/client step ids (the keys of STEP_LABELS) to a friendly label +
// icon so the immersive "Cooking up your recipe" screen can render a
// checklist with the live step highlighted. The agent emits one
// `currentStep` at a time (not an index), so we resolve its position in
// this list to drive the done/now/upcoming states.
const PHASES: { id: string; label: string; icon: IconName }[] = [
  { id: "starting", label: "Reading your input", icon: "edit" },
  { id: "analyzing_photo", label: "Looking at the photo", icon: "camera" },
  { id: "writing_result", label: "Understanding the recipe", icon: "sparkle" },
  { id: "working", label: "Structuring the recipe", icon: "list" },
  { id: "saving", label: "Saving the dish", icon: "check" },
  { id: "generating_image", label: "Generating a photo", icon: "camera" },
];

function phaseIndex(step: string | null | undefined): number {
  if (!step) return 0;
  const i = PHASES.findIndex((p) => p.id === step);
  return i === -1 ? 3 /* unknown agent tool → bucket into "working" */ : i;
}

// Step identifiers. The first four (starting/analyzing_photo/writing_result/
// working) come from claude-agent's runner — see src/jobs/runner.ts::stepForTool
// in that repo. The last two are client-side (we set them as we move through
// the save → image phases). New agent tool names get bucketed into `working`
// server-side; the fallback below catches them.
const STEP_LABELS: Record<string, string> = {
  starting: "Starting up…",
  analyzing_photo: "Looking at the photo…",
  writing_result: "Writing the recipe…",
  working: "Working on it…",
  saving: "Saving recipe…",
  generating_image: "Generating dish image…",
};

function labelForStep(step: string | null | undefined): string {
  if (!step) return "Starting up…";
  return STEP_LABELS[step] ?? "Working on it…";
}

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 180_000;

const IMAGE_POLL_INTERVAL_MS = 1000;
// Image gen is best-effort; we don't want to block the user forever. After
// this, redirect to the dish page anyway — the background image gen will
// land whenever it finishes.
const IMAGE_POLL_TIMEOUT_MS = 60_000;

// localStorage stash so we can resume an in-flight ingest if the user closes
// the tab. claude-agent jobs auto-delete after 24h; we cap our resume window
// at 10 min so a stale stash doesn't ambush the user when they come back days
// later.
const PENDING_KEY = "dinner-spinner:pending-ingest";
const PENDING_TTL_MS = 10 * 60 * 1000;

// Image handling for the eventual save. For URL imports `sourceImageUrl` is
// the recipe page's own photo (used unless `generateImage` is toggled on).
type ImageOpts = { sourceImageUrl: string | null; generateImage: boolean };

type PendingState =
  | {
      stage: "ingest";
      jobId: string;
      startedAt: number;
      sourceImageUrl?: string | null;
      generateImage?: boolean;
    }
  | { stage: "image"; dishId: number; startedAt: number };

function readStash(): PendingState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingState;
    if (
      !parsed ||
      typeof parsed.startedAt !== "number" ||
      Date.now() - parsed.startedAt > PENDING_TTL_MS
    ) {
      window.localStorage.removeItem(PENDING_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStash(state: PendingState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(state));
  } catch {
    // Quota / private-mode: best-effort. The flow still works in-tab; only
    // the resume-after-close fallback degrades.
  }
}

function clearStash(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // Same as writeStash — non-fatal.
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function IngestInput() {
  const router = useRouter();
  const [input, setInput] = useState("");
  // URL imports default to the recipe page's own photo; this toggle (shown only
  // when the input is a URL) forces AI generation instead. Default off.
  const [generateImage, setGenerateImage] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [compressedPreviewUrl, setCompressedPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<string | null>(null);

  // Tick once per second while a job is in flight so the user sees the
  // elapsed-time counter advance even between status events.
  useEffect(() => {
    if (!loading || startedAt === null) return;
    const interval = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [loading, startedAt]);

  // Warn the user if they try to close the tab mid-flight. Modern browsers
  // ignore custom messages, but setting `returnValue` triggers the native
  // "Leave site?" prompt. Resume-on-mount (below) covers the case where they
  // close anyway, but the prompt nudges most accidental closes.
  useEffect(() => {
    if (!loading) return;
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [loading]);

  // If the user closed the tab during an ingest, pick up where we left off
  // on next mount. claude-agent keeps the job in `api_jobs` for 24h; we only
  // resume within 10 min so a stale stash doesn't ambush them later.
  useEffect(() => {
    const pending = readStash();
    if (!pending) {
      // No in-flight ingest to resume — if we arrived via the Android share
      // target (/add?title=…&text=…&url=…), prefill the textarea. The user
      // still taps "Ingest recipe" to run it.
      const prefill = buildSharePrefillFromSearch(window.location.search);
      if (prefill) setInput(prefill);
      return;
    }
    setLoading(true);
    setStartedAt(pending.startedAt);
    setElapsedSec(Math.floor((Date.now() - pending.startedAt) / 1000));
    void resumeFromStash(pending);
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resumeFromStash(pending: PendingState): Promise<void> {
    let navigated = false;
    try {
      if (pending.stage === "ingest") {
        navigated = await runFlowFromIngest(pending.jobId, pending.startedAt, {
          sourceImageUrl: pending.sourceImageUrl ?? null,
          generateImage: pending.generateImage ?? false,
        });
      } else {
        navigated = await runFlowFromImage(pending.dishId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected failure");
    } finally {
      if (!navigated) setLoading(false);
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (compressedPreviewUrl) URL.revokeObjectURL(compressedPreviewUrl);
    setFile(f);
    setCompressedPreviewUrl(f ? URL.createObjectURL(f) : null);
    setError(null);
  }

  function clearFile() {
    setFile(null);
    if (compressedPreviewUrl) URL.revokeObjectURL(compressedPreviewUrl);
    setCompressedPreviewUrl(null);
  }

  useEffect(() => {
    return () => {
      if (compressedPreviewUrl) URL.revokeObjectURL(compressedPreviewUrl);
    };
  }, [compressedPreviewUrl]);

  async function ingest() {
    if (!input.trim() && !file) return;
    setLoading(true);
    setError(null);
    setRawResponse(null);
    setCurrentStep(null);
    setElapsedSec(0);
    const startedAt = Date.now();
    setStartedAt(startedAt);

    // Set inside the success branch so the `finally` clause knows to leave
    // `loading` true — we want the overlay to stay up until router.push
    // completes its navigation; otherwise the form flickers back into view
    // for a frame between save and navigation.
    let navigated = false;

    try {
      let image: CompressedImage | undefined;
      if (file) image = await compressImage(file);

      const start = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: input.trim() || undefined,
          image,
        }),
      });
      const startBody = (await start.json().catch(() => ({}))) as {
        jobId?: string;
        sourceImageUrl?: string | null;
        error?: { code?: string; message?: string };
      };
      if (!start.ok || !startBody.jobId) {
        setError(startBody.error?.message ?? `Ingest failed (${start.status})`);
        return;
      }
      const jobId = startBody.jobId;
      const imageOpts: ImageOpts = {
        sourceImageUrl: startBody.sourceImageUrl ?? null,
        generateImage,
      };
      writeStash({ stage: "ingest", jobId, startedAt, ...imageOpts });

      navigated = await runFlowFromIngest(jobId, startedAt, imageOpts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected failure");
    } finally {
      // On success we navigated; the new page mounts and replaces this
      // component. On error/timeout the user stays here, so drop the
      // overlay so they can see the error.
      if (!navigated) setLoading(false);
    }
  }

  /**
   * Drive the flow from `ingest` stage onwards: poll the agent job, save the
   * dish, wait for the image, redirect. Used both by a fresh ingest() and by
   * the resume-on-mount path. Returns true if we navigated, false if we set
   * an error and stopped. Updates `pending-ingest` localStorage as it
   * progresses through the stages so each stage is independently resumable.
   */
  async function runFlowFromIngest(
    jobId: string,
    startedAt: number,
    imageOpts: ImageOpts,
  ): Promise<boolean> {
    const dish = await pollIngestUntilDone(jobId);
    if (!dish) return false;
    return runFlowFromSave(dish, startedAt, imageOpts);
  }

  async function runFlowFromSave(
    dish: DishInput,
    startedAt: number,
    imageOpts: ImageOpts,
  ): Promise<boolean> {
    setCurrentStep("saving");
    const saveRes = await fetch("/api/dishes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...dish,
        sourceImageUrl: imageOpts.sourceImageUrl,
        generateImage: imageOpts.generateImage,
      }),
    });
    if (!saveRes.ok) {
      const body = (await saveRes.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(body.error ?? `Save failed (${saveRes.status})`);
      // Save failure leaves the agent's parse intact in claude-agent — leave
      // the stash in place so refreshing the page retries from the parse,
      // not from a fresh photo.
      return false;
    }
    const saved = (await saveRes.json()) as Dish;
    writeStash({ stage: "image", dishId: saved.id, startedAt });
    return runFlowFromImage(saved.id);
  }

  async function runFlowFromImage(dishId: number): Promise<boolean> {
    setCurrentStep("generating_image");
    const imageStart = Date.now();
    while (Date.now() - imageStart < IMAGE_POLL_TIMEOUT_MS) {
      await sleep(IMAGE_POLL_INTERVAL_MS);
      const r = await fetch(`/api/dishes/${dishId}`);
      if (r.status === 404) {
        // Dish no longer exists (rare — user deleted from another tab?).
        setError("Dish no longer exists.");
        clearStash();
        return false;
      }
      if (r.ok) {
        const fresh = (await r.json()) as Dish;
        if (fresh.imageUrl) break;
      }
    }
    clearStash();
    router.push(`/dishes/${dishId}`);
    return true;
  }

  /**
   * Poll claude-agent's job until status flips to done|failed. Surfaces the
   * agent's `currentStep` to the overlay along the way. Returns the parsed
   * dish on success, or null after setting an error.
   */
  async function pollIngestUntilDone(
    jobId: string,
  ): Promise<DishInput | null> {
    const pollStartedAt = Date.now();
    while (Date.now() - pollStartedAt < POLL_TIMEOUT_MS) {
      const poll = await fetch(`/api/ingest/jobs/${jobId}`);
      if (poll.status === 404) {
        // The agent job is gone — 24h auto-cleanup or claude-agent was
        // wiped. Don't keep retrying.
        setError("Previous recipe ingest has expired. Please try again.");
        clearStash();
        return null;
      }
      const pollBody = (await poll.json().catch(() => ({}))) as {
        status?: string;
        currentStep?: string | null;
        dish?: DishInput;
        error?: { code?: string; message?: string; rawResponse?: string | null };
      };
      if (!poll.ok) {
        setError(pollBody.error?.message ?? `Poll failed (${poll.status})`);
        setRawResponse(pollBody.error?.rawResponse ?? null);
        return null;
      }
      if (pollBody.status === "done" && pollBody.dish) {
        return pollBody.dish;
      }
      if (pollBody.status === "failed") {
        setError(pollBody.error?.message ?? "Ingest failed");
        setRawResponse(pollBody.error?.rawResponse ?? null);
        clearStash();
        return null;
      }
      if (pollBody.currentStep !== undefined) {
        setCurrentStep(pollBody.currentStep ?? null);
      }
      await sleep(POLL_INTERVAL_MS);
    }
    setError("Ingest is taking unusually long. Try again, or check claude-agent.");
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await ingest();
  }

  const canSubmit = (input.trim().length > 0 || file !== null) && !loading;

  return (
    <form onSubmit={submit}>
      {loading && <IngestOverlay step={currentStep} elapsedSec={elapsedSec} />}

      {/* Unified input card: textarea + photo footer. */}
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface transition-colors focus-within:border-accent-line">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={6}
          placeholder={"Paste recipe text, drop a URL, or describe a dish — “a sticky miso aubergine for two”"}
          className="block w-full resize-none border-0 bg-transparent px-4 py-[15px] text-[15px] leading-[1.5] text-text outline-none placeholder:text-text-faint"
          style={{ fontFamily: "var(--font-sans)", minHeight: 120 }}
          disabled={loading}
        />
        <div className="flex items-center gap-[10px] border-t border-line bg-surface-2 px-3 py-[10px]">
          {compressedPreviewUrl ? (
            <div className="flex min-w-0 flex-1 items-center gap-[9px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={compressedPreviewUrl}
                alt="attached"
                className="h-10 w-10 shrink-0 rounded-[var(--radius-sm)] border border-line object-cover"
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-text-dim">
                {file?.name || "Photo attached"}
              </span>
              <button
                type="button"
                onClick={clearFile}
                disabled={loading}
                aria-label="Remove photo"
                className="shrink-0 p-[6px] text-text-faint"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ) : (
            <>
              <label className="flex cursor-pointer items-center gap-[7px] rounded-[var(--radius-sm)] border border-line bg-surface-3 px-3 py-2 text-[13px] font-semibold text-text">
                <Icon name="camera" size={16} />
                Add a photo
                <input
                  type="file"
                  accept="image/*"
                  onChange={onFile}
                  disabled={loading}
                  className="hidden"
                />
              </label>
              {/* Camera capture — separate hidden input so phones offer the camera. */}
              <label className="flex cursor-pointer items-center gap-[7px] rounded-[var(--radius-sm)] border border-line bg-surface-3 px-3 py-2 text-[13px] font-semibold text-text sm:hidden">
                <Icon name="camera" size={16} />
                Camera
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={onFile}
                  disabled={loading}
                  className="hidden"
                />
              </label>
              <span className="hidden flex-1 text-[12px] text-text-faint sm:block">
                Camera or library · compressed first
              </span>
            </>
          )}
        </div>
      </div>

      {/* URL imports use the recipe page's own photo by default; this toggle
          forces an AI-generated image instead. Only shown for a bare URL. */}
      {isRecipeUrl(input) && !file && (
        <label className="mt-3 flex cursor-pointer items-start gap-[10px] rounded-[var(--radius-md)] border border-line bg-surface-2 px-[13px] py-[11px]">
          <input
            type="checkbox"
            checked={generateImage}
            onChange={(e) => setGenerateImage(e.target.checked)}
            disabled={loading}
            className="mt-[2px] h-4 w-4 shrink-0"
            style={{ accentColor: "var(--accent)" }}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-semibold text-text">
              Generate a new image with AI
            </span>
            <span className="mt-[1px] block text-[12.5px] text-text-faint">
              Off: use the recipe&rsquo;s own photo from the page.
            </span>
          </span>
        </label>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-4 flex h-[54px] w-full items-center justify-center gap-2 rounded-pill text-[16px] font-semibold transition-colors disabled:cursor-default"
        style={{
          fontFamily: "var(--font-sans)",
          background: canSubmit ? "var(--accent)" : "var(--surface-2)",
          color: canSubmit ? "var(--accent-ink)" : "var(--text-faint)",
        }}
      >
        <Icon
          name="sparkle"
          size={20}
          style={{ color: canSubmit ? "var(--accent-ink)" : "var(--text-faint)" }}
        />
        Ingest recipe
      </button>
      <div className="mt-[10px] text-center text-[12px] text-text-faint">
        Takes about a minute — you can leave and come back.
      </div>

      {error && (
        <div className="mt-4 space-y-2 rounded-[var(--radius-md)] border border-rose bg-rose-tint p-3 text-[13.5px] text-text">
          <p className="flex items-start gap-2">
            <Icon name="close" size={16} style={{ color: "var(--rose)", flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </p>
          {rawResponse && (
            <details>
              <summary className="cursor-pointer text-[12px] text-text-dim underline">
                Show raw response
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-[12px] text-text-dim">
                {rawResponse}
              </pre>
            </details>
          )}
          <div className="pt-1">
            <button
              type="button"
              onClick={ingest}
              disabled={loading}
              className="inline-flex items-center gap-[6px] rounded-pill bg-surface-2 px-4 py-2 text-[13px] font-semibold text-text-dim transition-colors hover:bg-surface-3 disabled:opacity-50"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              <Icon name="reset" size={14} />
              Retry
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

/**
 * Full-screen immersive "Cooking up your recipe" overlay shown while a
 * recipe is ingested, saved, and image-generated. Reads the real
 * `currentStep` + elapsed seconds (preserved data contract) and renders the
 * V2 ember progress ring, the current phase's icon + label, an elapsed
 * counter, and a phase checklist. Blocks the form behind it.
 */
function IngestOverlay({ step, elapsedSec }: { step: string | null; elapsedSec: number }) {
  const idx = phaseIndex(step);
  const cur = PHASES[Math.min(idx, PHASES.length - 1)];
  const label = labelForStep(step); // real label (handles unknown agent tools)
  const slow = elapsedSec > 75;
  const pct = Math.min(100, Math.round((idx / PHASES.length) * 100));
  const R = 52;
  const C = 2 * Math.PI * R;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[80] flex flex-col overflow-hidden bg-bg-deep px-6"
    >
      {/* ambient warmth */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 -top-[60px] -translate-x-1/2"
        style={{
          width: 360,
          height: 360,
          borderRadius: "50%",
          background: "radial-gradient(circle, var(--accent-tint), transparent 68%)",
          animation: "ds-breathe 3.2s ease-in-out infinite",
        }}
      />

      <div className="relative z-[1] flex flex-1 flex-col items-center justify-center">
        {/* progress ring + ember */}
        <div className="relative" style={{ width: 140, height: 140 }}>
          <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="70" cy="70" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="3" />
            <circle
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - pct / 100)}
              style={{ transition: "stroke-dashoffset .7s cubic-bezier(.3,.7,.3,1)" }}
            />
          </svg>
          <div
            className="absolute grid place-items-center"
            style={{
              inset: 30,
              borderRadius: "50%",
              background: "radial-gradient(circle at 42% 36%, var(--accent-2), var(--accent-deep))",
              boxShadow: "0 0 38px -4px var(--accent-deep)",
              animation: "ds-breathe 3.2s ease-in-out infinite",
            }}
          >
            <div key={idx} style={{ animation: "ds-pop .4s ease" }}>
              <Icon name={cur.icon} size={30} stroke={2} style={{ color: "var(--accent-ink)" }} />
            </div>
          </div>
          <div
            className="absolute left-1/2 -translate-x-1/2 rounded-pill border border-line bg-surface px-[10px] py-[2px] text-[12px] font-bold text-accent-2"
            style={{ bottom: -2, fontVariantNumeric: "tabular-nums" }}
          >
            {pct}%
          </div>
        </div>

        <div className="mt-[26px] text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          Cooking up your recipe
        </div>
        <h2
          key={idx}
          className="m-0 mt-3 text-center font-medium tracking-[-0.01em] text-text"
          style={{ fontFamily: "var(--font-serif)", fontSize: 25, minHeight: 32, animation: "ds-stepin .4s ease" }}
        >
          {label}…
        </h2>
        <div className="mt-[10px] text-[12.5px] text-text-faint" style={{ fontVariantNumeric: "tabular-nums" }}>
          {elapsedSec}s elapsed
        </div>
        {slow && (
          <div className="mt-2 max-w-[250px] text-center text-[12.5px] leading-[1.45] text-accent-2">
            Taking a little longer than usual — hang tight, it&apos;s still working.
          </div>
        )}
      </div>

      {/* phase checklist — anchored lower */}
      <div className="relative z-[1]" style={{ paddingBottom: "calc(var(--safe-top) + 6px)" }}>
        <div className="mx-auto w-full max-w-md rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-[6px] shadow-[var(--shadow-card)]">
          {PHASES.map((p, i) => {
            const isDone = i < idx;
            const isNow = i === idx;
            return (
              <div key={p.id} className="relative flex items-center gap-3 py-2">
                {i < PHASES.length - 1 && (
                  <span
                    className="absolute"
                    style={{ left: 10, top: 30, width: 1.5, height: 14, background: isDone ? "var(--sage)" : "var(--line-2)" }}
                  />
                )}
                <span
                  className="grid shrink-0 place-items-center rounded-pill transition-all"
                  style={{
                    width: 21,
                    height: 21,
                    background: isDone ? "var(--sage)" : isNow ? "var(--accent)" : "var(--surface-3)",
                    boxShadow: isNow ? "0 0 0 4px var(--accent-tint)" : "none",
                  }}
                >
                  {isDone ? (
                    <Icon name="check" size={12} style={{ color: "#10140E" }} />
                  ) : isNow ? (
                    <span
                      className="rounded-pill"
                      style={{ width: 6, height: 6, background: "var(--accent-ink)", animation: "ds-blink 1.1s ease-in-out infinite" }}
                    />
                  ) : (
                    <span className="rounded-pill" style={{ width: 5, height: 5, background: "var(--text-faint)" }} />
                  )}
                </span>
                <span
                  className="flex-1 text-[13.5px] transition-colors"
                  style={{
                    fontWeight: isNow ? 600 : 500,
                    color: isNow ? "var(--text)" : isDone ? "var(--text-dim)" : "var(--text-faint)",
                  }}
                >
                  {p.label}
                </span>
                {isDone && <Icon name="check" size={14} style={{ color: "var(--sage)" }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
