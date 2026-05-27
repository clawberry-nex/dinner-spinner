"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { compressImage, type CompressedImage } from "@/lib/image-compress";
import type { Dish, DishInput } from "@/lib/types";
import { Button } from "../_components/ui";

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

type PendingState =
  | { stage: "ingest"; jobId: string; startedAt: number }
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
    if (!pending) return;
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
        navigated = await runFlowFromIngest(pending.jobId, pending.startedAt);
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
        error?: { code?: string; message?: string };
      };
      if (!start.ok || !startBody.jobId) {
        setError(startBody.error?.message ?? `Ingest failed (${start.status})`);
        return;
      }
      const jobId = startBody.jobId;
      writeStash({ stage: "ingest", jobId, startedAt });

      navigated = await runFlowFromIngest(jobId, startedAt);
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
  ): Promise<boolean> {
    const dish = await pollIngestUntilDone(jobId);
    if (!dish) return false;
    return runFlowFromSave(dish, startedAt);
  }

  async function runFlowFromSave(
    dish: DishInput,
    startedAt: number,
  ): Promise<boolean> {
    setCurrentStep("saving");
    const saveRes = await fetch("/api/dishes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(dish),
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
    <form onSubmit={submit} className="space-y-4">
      {loading && (
        <IngestOverlay step={currentStep} elapsedSec={elapsedSec} />
      )}
      <p className="text-sm text-zinc-500">
        Paste a recipe, a URL, or describe a dish in your own words. Optionally
        attach a photo (a cookbook page, a recipe screenshot, an ingredient
        list). Claude will parse it and save the dish; you&apos;ll land on the
        dish page when it&apos;s ready.
      </p>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={10}
        placeholder="Paste a recipe, URL, or describe a dish…"
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        disabled={loading}
      />

      <div className="space-y-2">
        <label className="block text-sm font-medium">Attach photo (optional)</label>
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
            📷 Take photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFile}
              disabled={loading}
              className="hidden"
            />
          </label>
          <label className="cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
            🖼️ Choose from library
            <input
              type="file"
              accept="image/*"
              onChange={onFile}
              disabled={loading}
              className="hidden"
            />
          </label>
        </div>
        {compressedPreviewUrl && (
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={compressedPreviewUrl}
              alt="attached"
              className="max-h-48 rounded-md border border-zinc-300 dark:border-zinc-700"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearFile}
              disabled={loading}
            >
              Remove
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={!canSubmit}>
          Add Recipe →
        </Button>
      </div>

      {error && (
        <div className="space-y-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p>{error}</p>
          {rawResponse && (
            <details>
              <summary className="cursor-pointer text-xs underline">
                Show raw response
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-xs">
                {rawResponse}
              </pre>
            </details>
          )}
          <div className="flex items-center gap-3 pt-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={ingest}
              disabled={loading}
            >
              Retry
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

/**
 * Full-screen darkened overlay shown while a recipe is being ingested,
 * saved, and image-generated. Reads the current step + elapsed seconds and
 * renders a centered card with the step label, a spinner, and a counter.
 * Blocks pointer events on the form behind it via the backdrop.
 */
function IngestOverlay({
  step,
  elapsedSec,
}: {
  step: string | null;
  elapsedSec: number;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl dark:bg-zinc-900">
        <div className="flex flex-col items-center gap-4">
          <div
            aria-hidden="true"
            className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"
          />
          <p className="text-center text-lg font-medium text-zinc-900 dark:text-zinc-100">
            {labelForStep(step)}
          </p>
          <p className="text-sm tabular-nums text-zinc-500">{elapsedSec}s</p>
        </div>
      </div>
    </div>
  );
}
