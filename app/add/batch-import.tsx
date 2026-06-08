"use client";

// ============================================================
// batch-import.tsx — the parse + SIMULATED engine for "Batch import".
//
// PREVIEW / SIMULATION. This is a UI preview of the bulk-import flow.
// The parser (`parseImportText`) is REAL — it reads pasted/loaded text
// and pulls recipe titles out of it. Everything past "Analyze" is a
// client-side simulation driven by timers: no recipe is ever created,
// no photo is generated, and crucially NO `/api/dishes` or `/api/ingest`
// call is made. Nothing is written to the real library.
//
// TODO: wire to the real batch import pipeline — roadmap QNGIkXIN62Sc
// (this is a UI preview / simulation)
//
// Re-expressed from the V2 prototype (batch-import.jsx) in TypeScript.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";

// ---------- parsing: pull recipe titles out of pasted/loaded text ----------

const MAX_TITLES = 60;

function biDedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let t of list) {
    t = (t || "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_TITLES) break;
  }
  return out;
}

/**
 * REAL parser. Pull a list of recipe titles out of arbitrary text:
 * JSON arrays / `{recipes|dishes|items}`, markdown `#/##/###` headings,
 * numbered `1.`/`1)` lists, blank-line blocks, bullet lists, or a
 * per-line fallback. Deduped and capped at 60.
 */
export function parseImportText(input: string): string[] {
  const text = (input || "").trim();
  if (!text) return [];

  // 1) JSON — array of strings/objects, or { recipes: [...] }
  try {
    const j = JSON.parse(text) as unknown;
    let arr: unknown[];
    if (Array.isArray(j)) {
      arr = j;
    } else if (j && typeof j === "object") {
      const obj = j as Record<string, unknown>;
      arr = (obj.recipes as unknown[]) || (obj.dishes as unknown[]) || (obj.items as unknown[]) || [];
    } else {
      arr = [];
    }
    const titles = arr
      .map((x) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object") {
          const o = x as Record<string, unknown>;
          return (o.title as string) || (o.name as string) || "";
        }
        return "";
      })
      .filter(Boolean) as string[];
    if (titles.length) return biDedupe(titles);
  } catch {
    /* not json */
  }

  const lines = text.split(/\r?\n/);

  // 2) markdown headings (#, ##, ###)
  let titles: string[] = [];
  for (const ln of lines) {
    const m = ln.match(/^\s{0,3}#{1,3}\s+(.+?)\s*#*$/);
    if (m) titles.push(m[1]);
  }
  if (titles.length >= 2) return biDedupe(titles);

  // 3) numbered list — "1. Title" / "1) Title"
  titles = [];
  for (const ln of lines) {
    const m = ln.match(/^\s*\d+[.)]\s+(.+)$/);
    if (m) titles.push(m[1].replace(/\s*[-–—:].*$/, ""));
  }
  if (titles.length >= 2) return biDedupe(titles);

  // 4) blank-line-separated blocks → first line of each
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length >= 2) {
    return biDedupe(blocks.map((b) => b.split(/\r?\n/)[0].replace(/^[#\-*•\d.)\s]+/, "")));
  }

  // 5) bullet list — "- Title" / "* Title"
  titles = [];
  for (const ln of lines) {
    const m = ln.match(/^\s*[-*•]\s+(.+)$/);
    if (m) titles.push(m[1]);
  }
  if (titles.length >= 2) return biDedupe(titles);

  // 6) fallback — each non-empty line is a recipe
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  if (nonEmpty.length >= 2 && nonEmpty.length <= MAX_TITLES) {
    return biDedupe(nonEmpty.map((l) => l.replace(/^[#\-*•\d.)\s]+/, "")));
  }
  return biDedupe(nonEmpty.slice(0, 1));
}

// ---------- a believable emoji for a found title (display only) ----------

const BI_EMOJI = ["🍲", "🥘", "🍜", "🥗", "🍛", "🫕", "🍝", "🥙", "🥚", "🧆", "🥟", "🍤"];

export function biHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * SIMULATION-ONLY: a display emoji for a found title. The prototype's
 * `makeImportedDish` fabricated a whole dish object here; we only need
 * the emoji for the "found" list, so this stays purely presentational and
 * never produces anything that touches the real library.
 */
export function makeImportedDish(title: string): { emoji: string } {
  const h = biHash(title);
  return { emoji: BI_EMOJI[h % BI_EMOJI.length] };
}

// ---------- the engine: state + SIMULATED background driver ----------

const BI_ANALYZE_MS = 2200;
const BI_STAGGER_MS = 850; // gap between starting each import
const BI_IMPORT_MS = 650; // time to "create" one dish
const BI_PHOTO_MIN = 1500;
const BI_PHOTO_VAR = 2600; // photo arrives a little later

export type PhotoState = "pending" | "done" | "failed";
export type RecipeStatus = "pending" | "working" | "imported" | "failed";

export type ImportRecipe = {
  title: string;
  status: RecipeStatus;
  photo: PhotoState;
  // Deterministic-per-recipe random rolls so a re-render doesn't reroll
  // whether a given recipe fails. Matches the prototype.
  failRoll: number;
  photoRoll: number;
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
  confirm: () => void;
  retry: (i: number) => void;
  retryPhoto: (i: number) => void;
  dismiss: () => void;
  reset: () => void;
};

/**
 * SIMULATED batch-import engine. Mirrors the prototype's `useImportEngine`
 * state machine with setTimeout-driven progress. It NEVER calls a real
 * API and NEVER mutates the real dish library — `runOne` flips a recipe's
 * status to "imported" and lets a "photo" resolve a beat later, all in
 * local state only.
 *
 * TODO: wire to the real batch import pipeline — roadmap QNGIkXIN62Sc
 * (this is a UI preview / simulation)
 */
export function useImportEngine(toast?: (msg: string) => void): ImportEngine {
  const [job, setJob] = useState<ImportJob | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const push = useCallback((t: ReturnType<typeof setTimeout>) => {
    timers.current.push(t);
    return t;
  }, []);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  useEffect(() => () => clearTimers(), [clearTimers]);

  const patch = useCallback((i: number, p: Partial<ImportRecipe>) => {
    setJob((j) =>
      j ? { ...j, recipes: j.recipes.map((r, k) => (k === i ? { ...r, ...p } : r)) } : j,
    );
  }, []);

  const analyze: ImportEngine["analyze"] = useCallback(
    ({ text, fileName, source }) => {
      clearTimers();
      setJob({ status: "analyzing", source, fileName: fileName || "", text, recipes: [] });
      push(
        setTimeout(() => {
          const titles = parseImportText(text);
          const recipes: ImportRecipe[] = titles.map((title) => ({
            title,
            status: "pending",
            photo: "pending",
            failRoll: Math.random(),
            photoRoll: Math.random(),
          }));
          setJob((j) => (j ? { ...j, status: recipes.length ? "found" : "empty", recipes } : j));
        }, BI_ANALYZE_MS),
      );
    },
    [clearTimers, push],
  );

  // import a single recipe (SIMULATED): flip status, then its photo
  // arrives later. No dish is created; nothing leaves local state.
  const runOne = useCallback(
    (i: number, isRetry: boolean) => {
      patch(i, { status: "working" });
      push(
        setTimeout(
          () => {
            setJob((j) => {
              if (!j) return j;
              const r = j.recipes[i];
              const fail = !isRetry && r.failRoll < 0.06;
              if (fail) {
                return {
                  ...j,
                  recipes: j.recipes.map((x, k) => (k === i ? { ...x, status: "failed" } : x)),
                };
              }
              return {
                ...j,
                recipes: j.recipes.map((x, k) =>
                  k === i ? { ...x, status: "imported", photo: "pending" } : x,
                ),
              };
            });
            // photo, a little later, independently fallible (SIMULATED)
            push(
              setTimeout(
                () => {
                  setJob((j) => {
                    if (!j) return j;
                    const r = j.recipes[i];
                    if (r.status !== "imported") return j;
                    const photoFail = !isRetry && r.photoRoll < 0.13;
                    return {
                      ...j,
                      recipes: j.recipes.map((x, k) =>
                        k === i ? { ...x, photo: photoFail ? "failed" : "done" } : x,
                      ),
                    };
                  });
                },
                BI_PHOTO_MIN + Math.random() * BI_PHOTO_VAR,
              ),
            );
          },
          isRetry ? 600 : BI_IMPORT_MS,
        ),
      );
    },
    [patch, push],
  );

  const confirm: ImportEngine["confirm"] = useCallback(() => {
    setJob((j) => {
      if (!j) return j;
      j.recipes.forEach((r, i) => {
        if (r.status === "pending") push(setTimeout(() => runOne(i, false), 250 + i * BI_STAGGER_MS));
      });
      return { ...j, status: "importing", startedAt: Date.now() };
    });
  }, [push, runOne]);

  const retry: ImportEngine["retry"] = useCallback(
    (i) => {
      setJob((j) => (j ? { ...j, status: "importing" } : j));
      runOne(i, true);
    },
    [runOne],
  );

  const retryPhoto: ImportEngine["retryPhoto"] = useCallback((i) => {
    setJob((j) =>
      j ? { ...j, recipes: j.recipes.map((x, k) => (k === i ? { ...x, photo: "done" } : x)) } : j,
    );
  }, []);

  const dismiss: ImportEngine["dismiss"] = useCallback(() => {
    clearTimers();
    setJob(null);
  }, [clearTimers]);

  const reset: ImportEngine["reset"] = useCallback(() => {
    clearTimers();
    setJob((j) =>
      j ? { status: "idle", source: "paste", fileName: "", text: "", recipes: [] } : j,
    );
  }, [clearTimers]);

  // completion watcher — when nothing is pending/working, the import is
  // settled. Flip to "done" + toast on a deferred tick rather than
  // synchronously in the effect body (avoids cascading renders); a guard in
  // the updater makes the transition idempotent if the effect re-runs first.
  useEffect(() => {
    if (!job || job.status !== "importing") return;
    const busy = job.recipes.some((r) => r.status === "pending" || r.status === "working");
    if (busy) return;
    const total = job.recipes.length;
    const ok = job.recipes.filter((r) => r.status === "imported").length;
    const t = setTimeout(() => {
      setJob((j) => (j && j.status === "importing" ? { ...j, status: "done" } : j));
      toast?.(`Imported ${ok} of ${total}`);
    }, 0);
    return () => clearTimeout(t);
  }, [job, toast]);

  return { job, analyze, confirm, retry, retryPhoto, dismiss, reset };
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
