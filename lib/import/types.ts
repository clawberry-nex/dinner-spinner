// Shared types + pure mappers for batch import. NO server-only deps — this is
// imported by both the API routes (server) and the client engine (the wire
// shape lives here so there's one source of truth).

export type ImportStatus =
  | "detecting" // claude-agent detect job splitting the doc into recipes
  | "detected" // split done; awaiting the user's "Import all" confirm
  | "parsing" // per-chunk parse → create dish (covers parse + create)
  | "imaging" // dishes created; Gemini image batch generating + applying
  | "done"
  | "failed";

export type ChunkStatus = "queued" | "parsing" | "created" | "failed";
export type PhotoStatus = "pending" | "done" | "failed";

export interface ImportChunk {
  title: string;
  text: string;
  status: ChunkStatus;
  /** claude-agent parse job id while status === "parsing". */
  parseJobId?: string | null;
  /** dishes.id once status === "created". */
  dishId?: number | null;
  /** image outcome for the created dish (the Gemini batch result). */
  image?: PhotoStatus;
  error?: string | null;
}

export interface ImageBatch {
  /** Gemini batch job name, e.g. "batches/abc…". */
  name: string;
  state: string;
  /** true once every result for this batch has been applied (or marked failed). */
  applied: boolean;
}

/** The import_jobs DB row (chunks/image_batches are jsonb, auto-parsed by neon). */
export interface ImportRow {
  id: string;
  user_id: string;
  status: ImportStatus;
  detect_job_id: string | null;
  file_name: string | null;
  chunks: ImportChunk[];
  image_batches: ImageBatch[];
  error: string | null;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

/** Cast a raw neon row into a typed ImportRow (jsonb columns arrive parsed). */
export function parseImportRow(raw: Record<string, unknown>): ImportRow {
  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    status: raw.status as ImportStatus,
    detect_job_id: (raw.detect_job_id as string | null) ?? null,
    file_name: (raw.file_name as string | null) ?? null,
    chunks: (raw.chunks as ImportChunk[] | null) ?? [],
    image_batches: (raw.image_batches as ImageBatch[] | null) ?? [],
    error: (raw.error as string | null) ?? null,
    locked_until: raw.locked_until ? String(raw.locked_until) : null,
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
  };
}

// ---------- wire shape returned by GET /api/import/jobs/[id] ----------
// Per-recipe status uses the CLIENT's vocabulary so the engine can build its
// ImportRecipe rows directly (note: "pending" === a queued, not-yet-started chunk).
export type RecipeProgressStatus = "pending" | "working" | "imported" | "failed";

export interface RecipeProgress {
  title: string;
  status: RecipeProgressStatus;
  photo: PhotoStatus;
  dishId: number | null;
}

export interface ImportProgress {
  /** The server state-machine status; the client maps it to its job phase. */
  status: ImportStatus;
  recipes: RecipeProgress[];
  failedTitles: string[];
  error: string | null;
}

export function rowToImportProgress(row: Pick<ImportRow, "status" | "chunks" | "error">): ImportProgress {
  const recipes: RecipeProgress[] = row.chunks.map((c) => ({
    title: c.title,
    status:
      c.status === "queued"
        ? "pending"
        : c.status === "parsing"
          ? "working"
          : c.status === "failed"
            ? "failed"
            : "imported",
    photo: c.status === "created" ? (c.image ?? "pending") : "pending",
    dishId: c.dishId ?? null,
  }));
  return {
    status: row.status,
    recipes,
    failedTitles: row.chunks.filter((c) => c.status === "failed").map((c) => c.title),
    error: row.error,
  };
}
