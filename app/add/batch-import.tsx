"use client";

// ============================================================
// batch-import.tsx — the REAL batch-import engine.
//
// useImportEngine drives the same ImportEngine interface the UI
// (batch-panel.tsx) consumes, but instead of a setTimeout simulation it POSTs
// to /api/import and polls /api/import/jobs/[id]. That GET advances a
// server-side state machine ONE bounded step per poll (detect the recipes →
// parse each via claude-agent → create the dish → Nex GPT Image 2 batch). State
// lives in the import_jobs row, so the import survives navigation and resumes
// when you reopen /add. Real dishes are created; photos generate in the
// background. See roadmap QNGIkXIN62Sc.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import type { ImportProgress } from "@/lib/import/types";

// ---------- a believable emoji for a found title (display only) ----------

const BI_EMOJI = ["🍲", "🥘", "🍜", "🥗", "🍛", "🫕", "🍝", "🥙", "🥚", "🧆", "🥟", "🍤"];

export function biHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** A stable display emoji for a recipe title — used in the found list and as a
 *  placeholder photo tile. Purely presentational; the dish carries the real
 *  generated photo. */
export function makeImportedDish(title: string): { emoji: string } {
  const h = biHash(title);
  return { emoji: BI_EMOJI[h % BI_EMOJI.length] };
}

// ---------- the UI's view of an import ----------

export type PhotoState = "pending" | "done" | "failed";
export type RecipeStatus = "pending" | "working" | "imported" | "failed";

export type ImportRecipe = {
  title: string;
  status: RecipeStatus;
  photo: PhotoState;
  /** dishes.id once the recipe has been imported (lets the row link to it). */
  dishId: number | null;
};

export type JobStatus = "idle" | "analyzing" | "found" | "empty" | "importing" | "done";

export type ImportJob = {
  status: JobStatus;
  source: "file" | "paste";
  fileName: string;
  text: string;
  recipes: ImportRecipe[];
  startedAt?: number;
};

export type ImportEngine = {
  job: ImportJob | null;
  analyze: (args: { text: string; fileName?: string; source: "file" | "paste" }) => void;
  /** Adopt an already-running import (by id) and resume polling it — used by
   *  the shell to recover an in-flight import after a reload / navigation. */
  resume: (importId: string) => void;
  confirm: () => void;
  retry: (i: number) => void;
  retryPhoto: (i: number) => void;
  dismiss: () => void;
  reset: () => void;
};

const POLL_MS = 1800;
// The imaging phase can wait minutes on GPT Image 2, so poll gently there (the
// server independently throttles its Nex calls; this trims Vercel hits).
const IMAGE_PHASE_POLL_MS = 6000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Map the server state-machine status onto the UI's job phase. `imaging`
// becomes "done" — the dishes are all created (imported); photos are still
// arriving, which the done-state copy + the photo sub-status already convey.
function mapStatus(s: ImportProgress["status"]): JobStatus {
  switch (s) {
    case "detecting":
      return "analyzing";
    case "detected":
      return "found";
    case "parsing":
      return "importing";
    case "imaging":
      return "done";
    case "done":
      return "done";
    case "failed":
      return "empty";
  }
}

export function useImportEngine(toast?: (msg: string) => void): ImportEngine {
  const [job, setJob] = useState<ImportJob | null>(null);
  const jobRef = useRef<ImportJob | null>(null);
  const importIdRef = useRef<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastedDone = useRef(false);

  useEffect(() => {
    jobRef.current = job;
  }, [job]);

  const clearPoll = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);
  useEffect(() => () => clearPoll(), [clearPoll]);

  const patchRecipe = useCallback((i: number, p: Partial<ImportRecipe>) => {
    setJob((j) =>
      j ? { ...j, recipes: j.recipes.map((r, k) => (k === i ? { ...r, ...p } : r)) } : j,
    );
  }, []);

  const applyProgress = useCallback(
    (prog: ImportProgress) => {
      setJob((j) => {
        const base: ImportJob =
          j ?? { status: "idle", source: "paste", fileName: "", text: "", recipes: [] };
        const recipes: ImportRecipe[] = prog.recipes.map((r) => ({
          title: r.title,
          status: r.status,
          photo: r.photo,
          dishId: r.dishId,
        }));
        // One-shot "Imported X of N" toast the moment every dish has landed.
        if ((prog.status === "imaging" || prog.status === "done") && !toastedDone.current) {
          toastedDone.current = true;
          const imported = recipes.filter((r) => r.status === "imported").length;
          toast?.(`Imported ${imported} of ${recipes.length}`);
        }
        if (prog.status === "failed") toast?.(prog.error || "Couldn’t read that document.");
        return { ...base, status: mapStatus(prog.status), recipes };
      });
    },
    [toast],
  );

  const pollOnce = useCallback(
    async (importId: string) => {
      if (importIdRef.current !== importId) return;
      let prog: ImportProgress | null = null;
      let httpOk = false;
      try {
        const res = await fetch(`/api/import/jobs/${importId}`);
        httpOk = res.ok;
        if (res.ok) prog = (await res.json()) as ImportProgress;
      } catch {
        /* transient network error */
      }
      if (importIdRef.current !== importId) return;
      if (!prog) {
        // Keep trying — a little slower so a flaky network/server doesn't spin.
        pollTimer.current = setTimeout(() => pollOnce(importId), httpOk ? POLL_MS : 2800);
        return;
      }
      applyProgress(prog);
      const photosPending = prog.recipes.some(
        (r) => r.status === "imported" && r.photo === "pending",
      );
      const keep =
        prog.status === "detecting" ||
        prog.status === "parsing" ||
        prog.status === "imaging" ||
        (prog.status === "done" && photosPending);
      if (keep) {
        // detect/parse move fast; the imaging wait is gentle.
        const slow = prog.status === "imaging" || (prog.status === "done" && photosPending);
        pollTimer.current = setTimeout(() => pollOnce(importId), slow ? IMAGE_PHASE_POLL_MS : POLL_MS);
      }
      // detected → stop until confirm(); done(no photos)/failed → stop
    },
    [applyProgress],
  );

  const startPolling = useCallback(
    (importId: string, delay = POLL_MS) => {
      clearPoll();
      pollTimer.current = setTimeout(() => pollOnce(importId), delay);
    },
    [clearPoll, pollOnce],
  );

  const analyze: ImportEngine["analyze"] = useCallback(
    ({ text, fileName, source }) => {
      clearPoll();
      toastedDone.current = false;
      importIdRef.current = null;
      setJob({ status: "analyzing", source, fileName: fileName || "", text, recipes: [] });
      (async () => {
        try {
          const res = await fetch("/api/import", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text, fileName: fileName || undefined }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.importId) {
            toast?.(data?.error?.message || "Couldn’t start the import.");
            setJob((j) => (j ? { ...j, status: "empty" } : j));
            return;
          }
          importIdRef.current = data.importId as string;
          startPolling(data.importId, 600);
        } catch {
          toast?.("Couldn’t reach the server.");
          setJob((j) => (j ? { ...j, status: "empty" } : j));
        }
      })();
    },
    [clearPoll, startPolling, toast],
  );

  const resume: ImportEngine["resume"] = useCallback(
    (importId) => {
      if (importIdRef.current === importId) return; // already driving it
      clearPoll();
      importIdRef.current = importId;
      // It's already running — don't re-fire the "Imported X of N" toast.
      toastedDone.current = true;
      startPolling(importId, 0); // poll immediately to populate + continue
    },
    [clearPoll, startPolling],
  );

  const confirm: ImportEngine["confirm"] = useCallback(() => {
    const importId = importIdRef.current;
    if (!importId) return;
    setJob((j) => (j ? { ...j, status: "importing", startedAt: Date.now() } : j));
    fetch(`/api/import/${importId}/confirm`, { method: "POST" })
      .catch(() => {})
      .finally(() => startPolling(importId, 500));
  }, [startPolling]);

  const retry: ImportEngine["retry"] = useCallback(
    (i) => {
      const importId = importIdRef.current;
      if (!importId) return;
      setJob((j) => (j ? { ...j, status: "importing" } : j));
      patchRecipe(i, { status: "working" });
      fetch(`/api/import/${importId}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ index: i }),
      })
        .catch(() => {})
        .finally(() => startPolling(importId, 500));
    },
    [patchRecipe, startPolling],
  );

  // A failed/absent photo can be regenerated in place via the normal async
  // image-regen endpoint (the same one the dish edit page uses), then polled.
  const retryPhoto: ImportEngine["retryPhoto"] = useCallback(
    (i) => {
      const dishId = jobRef.current?.recipes[i]?.dishId;
      if (!dishId) return;
      patchRecipe(i, { photo: "pending" });
      (async () => {
        try {
          const res = await fetch(`/api/dishes/${dishId}/image`, { method: "POST" });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.jobId) {
            patchRecipe(i, { photo: "failed" });
            return;
          }
          for (let n = 0; n < 90; n++) {
            await sleep(2000);
            if (jobRef.current?.recipes[i]?.dishId !== dishId) return; // dismissed/changed
            const jr = await fetch(`/api/dishes/${dishId}/image/jobs/${data.jobId}`);
            if (!jr.ok) continue;
            const st = await jr.json();
            if (st.status === "done") {
              patchRecipe(i, { photo: "done" });
              return;
            }
            if (st.status === "failed") {
              patchRecipe(i, { photo: "failed" });
              return;
            }
          }
          patchRecipe(i, { photo: "failed" });
        } catch {
          patchRecipe(i, { photo: "failed" });
        }
      })();
    },
    [patchRecipe],
  );

  const dismiss: ImportEngine["dismiss"] = useCallback(() => {
    clearPoll();
    importIdRef.current = null;
    setJob(null);
  }, [clearPoll]);

  const reset: ImportEngine["reset"] = useCallback(() => {
    clearPoll();
    importIdRef.current = null;
    toastedDone.current = false;
    setJob((j) =>
      j ? { status: "idle", source: "paste", fileName: "", text: "", recipes: [] } : j,
    );
  }, [clearPoll]);

  return { job, analyze, resume, confirm, retry, retryPhoto, dismiss, reset };
}

// ---------- derived counts ----------

export type ImportCounts = {
  total: number;
  imported: number;
  failed: number;
  settled: number;
  photosPending: number;
};

export function biCounts(job: ImportJob | null): ImportCounts {
  const recipes = job?.recipes ?? [];
  return {
    total: recipes.length,
    imported: recipes.filter((r) => r.status === "imported").length,
    failed: recipes.filter((r) => r.status === "failed").length,
    settled: recipes.filter((r) => r.status === "imported" || r.status === "failed").length,
    photosPending: recipes.filter((r) => r.status === "imported" && r.photo === "pending").length,
  };
}

export function biActive(job: ImportJob | null): boolean {
  return !!job && job.status !== "idle";
}
