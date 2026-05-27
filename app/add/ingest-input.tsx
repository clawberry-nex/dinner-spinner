"use client";

import { useEffect, useState } from "react";
import { compressImage, type CompressedImage } from "@/lib/image-compress";
import type { DishInput } from "@/lib/types";
import { Button } from "../_components/ui";

export type IngestInputProps = {
  onParsed: (dish: DishInput) => void;
};

// Step identifiers come from claude-agent's runner — see
// src/jobs/runner.ts::stepForTool in that repo. New tool names get bucketed
// into `working` server-side; the fallback below catches them.
const STEP_LABELS: Record<string, string> = {
  starting: "Starting up…",
  analyzing_photo: "Looking at the photo…",
  writing_result: "Writing the recipe…",
  working: "Working on it…",
};

function labelForStep(step: string | null | undefined): string {
  if (!step) return "Starting up…";
  return STEP_LABELS[step] ?? "Working on it…";
}

export function IngestInput({ onParsed }: IngestInputProps) {
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
    setStartedAt(Date.now());

    try {
      let image: CompressedImage | undefined;
      if (file) image = await compressImage(file);

      // Step 1: start the job
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

      // Step 2: poll until done|failed. First poll fires immediately so
      // validation errors surface fast; subsequent polls run every 500ms,
      // giving ~250ms avg tail lag vs the previous 1500ms (~750ms avg).
      // With Haiku ingest at ~18s median that's roughly 36 polls per
      // ingest — well within Vercel Hobby invocation budgets.
      const POLL_INTERVAL_MS = 500;
      const POLL_TIMEOUT_MS = 180_000;
      const startedAt = Date.now();
      const jobId = startBody.jobId;

      // small helper so the loop reads cleanly
      const sleep = (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms));

      while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        const poll = await fetch(`/api/ingest/jobs/${jobId}`);
        const pollBody = (await poll.json().catch(() => ({}))) as {
          status?: string;
          currentStep?: string | null;
          dish?: DishInput;
          error?: { code?: string; message?: string; rawResponse?: string | null };
        };
        if (!poll.ok) {
          setError(pollBody.error?.message ?? `Poll failed (${poll.status})`);
          setRawResponse(pollBody.error?.rawResponse ?? null);
          return;
        }
        if (pollBody.status === "done" && pollBody.dish) {
          onParsed(pollBody.dish);
          return;
        }
        if (pollBody.status === "failed") {
          setError(pollBody.error?.message ?? "Ingest failed");
          setRawResponse(pollBody.error?.rawResponse ?? null);
          return;
        }
        // status === "pending" or "running" — surface the agent's current
        // step so the button label reflects real progress, then wait and
        // poll again.
        if (pollBody.currentStep !== undefined) {
          setCurrentStep(pollBody.currentStep ?? null);
        }
        await sleep(POLL_INTERVAL_MS);
      }
      setError("Ingest is taking unusually long. Try again, or check claude-agent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected failure");
    } finally {
      setLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await ingest();
  }

  const canSubmit = (input.trim().length > 0 || file !== null) && !loading;

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-zinc-500">
        Paste a recipe, a URL, or describe a dish in your own words. Optionally
        attach a photo (a cookbook page, a recipe screenshot, an ingredient
        list). Claude will parse it; you&apos;ll review the result in the
        normal dish form before saving.
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
          {loading ? labelForStep(currentStep) : "Ingest →"}
        </Button>
        {loading && (
          <span
            className="text-xs tabular-nums text-zinc-500"
            aria-live="polite"
          >
            {elapsedSec}s
          </span>
        )}
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
