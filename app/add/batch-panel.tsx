"use client";

// ============================================================
// batch-panel.tsx — the V2 UI for Batch import (PREVIEW).
//
// One shared <BatchPanel> drives every state (input · analyzing ·
// found · importing · summary). <BatchImportModal> wraps it as a
// centered desktop modal (Escape-closes); <BatchImportSheet> wraps it
// as a full-screen mobile sheet. <ImportDock> is the persistent
// "X of Y importing" pill you can return to.
//
// The engine behind this is SIMULATED — see batch-import.tsx. Nothing
// here ever writes to the real library.
//
// Re-expressed from the V2 prototype (batch-import-ui.jsx) in React +
// Tailwind + TypeScript using the V2 tokens.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { Icon } from "../_components/icon";
import {
  biActive,
  biCounts,
  makeImportedDish,
  type ImportCounts,
  type ImportEngine,
  type ImportRecipe,
  type RecipeStatus,
} from "./batch-import";

function biPct(c: ImportCounts): number {
  return c.total ? Math.round((c.settled / c.total) * 100) : 0;
}

// Reusable progress track (matches prototype's `.bi-track`).
function Track({ pct, color, height = 7 }: { pct: number; color: string; height?: number }) {
  return (
    <span
      className="block w-full overflow-hidden rounded-pill bg-surface-3"
      style={{ height }}
    >
      <span
        className="block h-full rounded-pill"
        style={{ width: `${pct}%`, background: color, transition: "width .5s cubic-bezier(.3,.7,.3,1)" }}
      />
    </span>
  );
}

// Small status indicator for a recipe row.
function BiStatusDot({ status }: { status: RecipeStatus }) {
  if (status === "imported") {
    return (
      <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-pill bg-sage">
        <Icon name="check" size={13} style={{ color: "#10140E" }} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-pill bg-rose">
        <span className="text-[13px] font-extrabold leading-none text-white">!</span>
      </span>
    );
  }
  if (status === "working") {
    return (
      <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-pill bg-accent">
        <span
          className="inline-block h-[11px] w-[11px] rounded-full border-2 border-[rgba(42,20,10,0.35)] border-t-[#2A140A]"
          style={{ animation: "ds-spin .7s linear infinite" }}
        />
      </span>
    );
  }
  // pending / queued
  return (
    <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-pill bg-surface-3">
      <span className="h-[5px] w-[5px] rounded-pill bg-text-faint" />
    </span>
  );
}

// Photo sub-status on the right of an imported row.
function BiPhotoTag({ r, onRetryPhoto }: { r: ImportRecipe; onRetryPhoto: () => void }) {
  if (r.status !== "imported") return null;
  if (r.photo === "done") {
    // SIMULATION: there is no real dish/image. Show a resolved accent tile
    // with the title's emoji to stand in for the generated photo.
    const { emoji } = makeImportedDish(r.title);
    return (
      <span
        className="grid h-[34px] w-[34px] shrink-0 place-items-center overflow-hidden rounded-[var(--radius-sm)] text-[17px]"
        style={{ background: "linear-gradient(135deg, var(--accent-deep), var(--accent))" }}
      >
        {emoji}
      </span>
    );
  }
  if (r.photo === "failed") {
    return (
      <button
        type="button"
        onClick={onRetryPhoto}
        title="Generate photo"
        className="flex shrink-0 items-center gap-[5px] rounded-[var(--radius-sm)] border border-line bg-surface-3 px-2 py-[5px] text-[11px] text-text-faint"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <Icon name="reset" size={12} style={{ color: "var(--text-faint)" }} />
        no photo
      </button>
    );
  }
  // pending — shimmering placeholder tile
  return (
    <span
      className="block h-[34px] w-[34px] shrink-0 rounded-[var(--radius-sm)]"
      style={{
        background:
          "linear-gradient(100deg, var(--surface-3) 30%, var(--line-2) 50%, var(--surface-3) 70%)",
        backgroundSize: "220% 100%",
        animation: "ds-shimmer 1.3s ease-in-out infinite",
      }}
    />
  );
}

function BiRow({
  r,
  idx,
  onRetry,
  onRetryPhoto,
  onAddManually,
}: {
  r: ImportRecipe;
  idx: number;
  onRetry: (i: number) => void;
  onRetryPhoto: (i: number) => void;
  onAddManually: (title: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-[10px] transition-colors [&_+_&]:border-t [&_+_&]:border-line hover:bg-surface-2">
      <BiStatusDot status={r.status} />
      <div className="min-w-0 flex-1">
        <div
          className={[
            "truncate text-[14.5px] font-semibold",
            r.status === "failed" ? "text-text-dim" : "text-text",
          ].join(" ")}
        >
          {r.title}
        </div>
        <div className="mt-[1px] text-[11.5px] text-text-faint">
          {r.status === "imported" &&
            (r.photo === "pending"
              ? "Imported · photo generating…"
              : r.photo === "failed"
                ? "Imported · no photo"
                : "Imported")}
          {r.status === "working" && "Importing…"}
          {r.status === "pending" && "Queued"}
          {r.status === "failed" && "Couldn’t import"}
        </div>
      </div>
      {r.status === "failed" ? (
        <div className="flex shrink-0 gap-[7px]">
          <button
            type="button"
            onClick={() => onRetry(idx)}
            className="inline-flex items-center gap-[5px] rounded-pill bg-surface-2 px-[11px] py-[6px] text-[11.5px] font-medium text-text-dim transition-colors hover:bg-surface-3"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            <Icon name="reset" size={12} />
            Retry
          </button>
          <button
            type="button"
            onClick={() => onAddManually(r.title)}
            className="inline-flex items-center gap-[5px] rounded-pill bg-surface-2 px-[11px] py-[6px] text-[11.5px] font-medium text-text-dim transition-colors hover:bg-surface-3"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            <Icon name="edit" size={12} />
            Manually
          </button>
        </div>
      ) : (
        <BiPhotoTag r={r} onRetryPhoto={() => onRetryPhoto(idx)} />
      )}
    </div>
  );
}

// ---------- the shared panel ----------
export function BatchPanel({
  variant,
  engine,
  onClose,
  onAddManually,
}: {
  variant: "mobile" | "desktop";
  engine: ImportEngine;
  onClose?: () => void;
  onAddManually: (title: string) => void;
}) {
  const { job } = engine;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [drag, setDrag] = useState(false);

  const status = job ? job.status : "idle";
  const c = biCounts(job);

  const loadFile = (file: File | undefined | null) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ""));
    reader.readAsText(file);
  };
  const canAnalyze = text.trim().length > 0;

  const padX = variant === "mobile" ? "px-5" : "px-7";

  // ---------- INPUT / EMPTY ----------
  if (!job || status === "idle" || status === "empty") {
    return (
      <div className={[padX, variant === "mobile" ? "pt-1 pb-6" : "pt-1 pb-[26px]"].join(" ")}>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          Batch import
        </div>
        <h2
          className="m-0 font-medium leading-[1.12] tracking-[-0.01em] text-text"
          style={{ fontFamily: "var(--font-serif)", fontSize: variant === "mobile" ? 24 : 26 }}
        >
          Import a batch of recipes
        </h2>
        <p className="mt-2 text-[14px] leading-[1.5] text-text-dim">
          Upload a <b className="text-text">.txt</b>, <b className="text-text">.md</b>, or{" "}
          <b className="text-text">.json</b> — or paste text with several recipes. I&apos;ll find
          each one; you confirm once and they all import.
        </p>

        {/* preview note */}
        <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-sm)] border border-accent-line bg-accent-tint px-3 py-2 text-[12px] text-accent-2">
          <Icon name="sparkle" size={14} style={{ flexShrink: 0 }} />
          <span>Preview — batch importing isn&apos;t wired up yet. Nothing is saved.</span>
        </div>

        {/* dropzone */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            loadFile(e.dataTransfer.files[0]);
          }}
          className="mt-[18px] flex w-full items-center gap-[13px] rounded-[var(--radius-md)] border-[1.5px] border-dashed px-4 py-[15px] text-left transition-colors"
          style={{
            borderColor: drag ? "var(--accent)" : "var(--line-2)",
            background: drag ? "var(--accent-tint)" : "var(--surface-2)",
          }}
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[11px] bg-surface-3">
            <Icon name="books" size={22} style={{ color: "var(--accent-2)" }} />
          </span>
          <div className="min-w-0 flex-1">
            {fileName ? (
              <>
                <div className="truncate text-[14px] font-semibold text-text">{fileName}</div>
                <div className="mt-[2px] text-[12px] text-text-faint">
                  Loaded · {text.trim().split(/\n/).filter(Boolean).length} lines · tap to replace
                </div>
              </>
            ) : (
              <>
                <div className="text-[14px] font-semibold text-text">
                  {drag ? "Drop to load the file" : "Drop a file, or browse"}
                </div>
                <div className="mt-[2px] text-[12px] text-text-faint">.txt · .md · .json</div>
              </>
            )}
          </div>
          {fileName && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setFileName("");
                setText("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  setFileName("");
                  setText("");
                }
              }}
              className="shrink-0 cursor-pointer p-[6px] text-text-faint"
              aria-label="Clear file"
            >
              <Icon name="close" size={16} />
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown,.json,text/plain"
            className="hidden"
            onChange={(e) => loadFile(e.target.files?.[0])}
          />
        </button>

        <div className="my-4 flex items-center gap-3 px-[2px]">
          <div className="h-px flex-1 bg-line" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-faint">
            or paste
          </span>
          <div className="h-px flex-1 bg-line" />
        </div>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (fileName) setFileName("");
          }}
          placeholder={
            "One recipe per line, or a markdown list:\n\n# Miso Aubergine\n# Lemon Roast Chicken\n# Chana Masala\n…"
          }
          className="block w-full resize-y rounded-[var(--radius-md)] border border-line bg-surface-2 px-[15px] py-[13px] text-[14.5px] leading-[1.55] text-text outline-none transition-colors focus:border-accent-line"
          style={{ minHeight: variant === "mobile" ? 120 : 132, fontFamily: "var(--font-sans)" }}
        />

        {status === "empty" && (
          <div className="mt-3 flex items-center gap-[9px] text-[13px] text-rose">
            <Icon name="close" size={15} style={{ color: "var(--rose)" }} />
            Couldn&apos;t find recipes in that. Try one title per line, or a markdown/JSON list.
          </div>
        )}

        <button
          type="button"
          disabled={!canAnalyze}
          onClick={() => engine.analyze({ text, fileName, source: fileName ? "file" : "paste" })}
          className="mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-pill text-[15.5px] font-semibold transition-colors disabled:cursor-default"
          style={{
            fontFamily: "var(--font-sans)",
            background: canAnalyze ? "var(--accent)" : "var(--surface-2)",
            color: canAnalyze ? "var(--accent-ink)" : "var(--text-faint)",
          }}
        >
          <Icon
            name="sparkle"
            size={19}
            style={{ color: canAnalyze ? "var(--accent-ink)" : "var(--text-faint)" }}
          />
          Analyze
        </button>
      </div>
    );
  }

  // ---------- ANALYZING ----------
  if (status === "analyzing") {
    return (
      <div
        className={[padX, "flex flex-col items-center text-center", variant === "mobile" ? "pt-[18px] pb-[30px]" : "pt-[22px] pb-8"].join(" ")}
      >
        {/* document with a sweeping scan line */}
        <div className="relative grid h-24 w-24 place-items-center overflow-hidden rounded-[var(--radius-lg)] border border-line-2 bg-surface shadow-[0_10px_30px_-12px_rgba(0,0,0,0.5)]">
          <Icon name="books" size={40} style={{ color: "var(--accent-2)" }} stroke={1.4} />
          <span
            className="absolute left-0 right-0"
            style={{
              height: "38%",
              background: "linear-gradient(180deg, transparent, var(--accent-tint), transparent)",
              boxShadow: "0 0 18px 2px var(--accent-tint)",
              animation: "ds-scan 1.7s ease-in-out infinite",
            }}
          />
        </div>
        <div className="mt-[22px] text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          Reading…
        </div>
        <h2
          className="m-0 mt-[10px] font-medium tracking-[-0.01em] text-text"
          style={{ fontFamily: "var(--font-serif)", fontSize: 24 }}
        >
          Looking for recipes
        </h2>
        <p className="mt-2 max-w-[300px] text-[13.5px] leading-[1.5] text-text-dim">
          Scanning {job.fileName ? <b className="text-text">{job.fileName}</b> : "your text"} for
          titles and structure.
        </p>
        <div className="mt-[18px] flex items-center gap-[9px]">
          <span
            className="inline-block h-4 w-4 rounded-full border-[2.5px] border-accent-line border-t-accent"
            style={{ animation: "ds-spin .7s linear infinite" }}
          />
          <span className="text-[13px] text-text-faint">A few seconds…</span>
        </div>
      </div>
    );
  }

  // ---------- FOUND ----------
  if (status === "found") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={[padX, "pt-1"].join(" ")}>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            Ready to import
          </div>
          <h2
            className="m-0 font-medium tracking-[-0.01em] text-text"
            style={{ fontFamily: "var(--font-serif)", fontSize: variant === "mobile" ? 25 : 27 }}
          >
            Found {c.total} recipe{c.total !== 1 ? "s" : ""}
          </h2>
          <p className="mt-2 text-[14px] leading-[1.5] text-text-dim">
            No editing now — import them all in one go, then tweak any of them later. Photos are
            generated as they land.
          </p>
        </div>
        <div
          className={[
            "my-[14px] min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-[var(--radius-lg)] border border-line bg-surface p-1",
            variant === "mobile" ? "mx-5" : "mx-7",
          ].join(" ")}
        >
          {job.recipes.map((r, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-[10px] [&_+_&]:border-t [&_+_&]:border-line"
            >
              <span
                className="w-6 shrink-0 text-right text-[14px] text-text-faint"
                style={{ fontFamily: "var(--font-serif)", fontVariantNumeric: "tabular-nums" }}
              >
                {i + 1}
              </span>
              <span className="shrink-0 text-[18px]">{makeImportedDish(r.title).emoji}</span>
              <div className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-text">
                {r.title}
              </div>
            </div>
          ))}
        </div>
        <div
          className={[
            "flex shrink-0 items-center gap-3 border-t border-line",
            variant === "mobile" ? "px-5 py-[14px]" : "px-7 py-4",
          ].join(" ")}
        >
          <button
            type="button"
            onClick={() => engine.reset()}
            className="shrink-0 rounded-pill border border-line-2 bg-transparent px-4 py-3 text-[14px] font-semibold text-text transition-colors hover:border-text-faint"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Different file
          </button>
          <button
            type="button"
            onClick={() => engine.confirm()}
            className="flex flex-1 items-center justify-center gap-2 rounded-pill bg-accent px-4 py-3 text-[14px] font-semibold text-accent-ink transition-colors hover:bg-accent-2"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            <Icon name="check" size={18} style={{ color: "var(--accent-ink)" }} />
            Import all {c.total}
          </button>
        </div>
      </div>
    );
  }

  // ---------- IMPORTING / DONE ----------
  const done = status === "done";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={[padX, "pt-1"].join(" ")}>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          {done ? "Import complete" : "Importing…"}
        </div>
        <div className="flex items-baseline gap-[10px]">
          <h2
            className="m-0 font-medium tracking-[-0.01em] text-text"
            style={{ fontFamily: "var(--font-serif)", fontSize: variant === "mobile" ? 27 : 30 }}
          >
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{c.imported}</span> of{" "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{c.total}</span> imported
          </h2>
          {!done && (
            <span
              className="inline-block h-[15px] w-[15px] rounded-full border-[2.5px] border-accent-line border-t-accent"
              style={{ animation: "ds-spin .7s linear infinite" }}
            />
          )}
        </div>
        <div className="mt-3">
          <Track
            pct={biPct(c)}
            color={done ? (c.failed ? "var(--gold)" : "var(--sage)") : "var(--accent)"}
          />
        </div>
        <p className="mt-[11px] text-[13.5px] leading-[1.5] text-text-dim">
          {done ? (
            c.failed ? (
              <>
                Imported {c.imported}, and {c.failed} need{c.failed === 1 ? "s" : ""} another look
                below. {c.photosPending > 0 && "A few photos are still arriving."}
              </>
            ) : (
              <>
                All {c.imported} are in your collection.
                {c.photosPending > 0 ? " Photos are still arriving." : " "}
              </>
            )
          ) : (
            <>
              Keep this open or come back later — it keeps importing in the background. Each dish
              opens the moment it lands; its photo follows.
            </>
          )}
        </p>
      </div>

      <div
        className={[
          "my-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-[var(--radius-lg)] border border-line bg-surface p-1",
          variant === "mobile" ? "mx-5" : "mx-7",
        ].join(" ")}
      >
        {job.recipes.map((r, i) => (
          <BiRow
            key={i}
            r={r}
            idx={i}
            onRetry={engine.retry}
            onRetryPhoto={engine.retryPhoto}
            onAddManually={onAddManually}
          />
        ))}
      </div>

      <div
        className={[
          "flex shrink-0 items-center gap-3 border-t border-line",
          variant === "mobile" ? "px-5 py-[14px]" : "px-7 py-4",
        ].join(" ")}
      >
        {done ? (
          <>
            {c.failed > 0 && variant !== "mobile" && (
              <span className="flex-1 text-[12.5px] text-text-faint">
                Retry a failed one, or add it by hand.
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                engine.dismiss();
                onClose?.();
              }}
              className="flex flex-1 items-center justify-center gap-2 rounded-pill bg-accent px-4 py-3 text-[14px] font-semibold text-accent-ink transition-colors hover:bg-accent-2"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              <Icon name="check" size={18} style={{ color: "var(--accent-ink)" }} />
              Done
            </button>
          </>
        ) : (
          <>
            <span className="flex flex-1 items-center gap-[7px] text-[12.5px] text-text-faint">
              <Icon name="check" size={13} style={{ color: "var(--sage)" }} />
              Runs in the background
            </span>
            <button
              type="button"
              onClick={() => onClose?.()}
              className="rounded-pill border border-line-2 bg-transparent px-4 py-3 text-[14px] font-semibold text-text transition-colors hover:border-text-faint"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              Hide
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- desktop modal wrapper ----------
export function BatchImportModal({
  open,
  engine,
  onClose,
  onAddManually,
}: {
  open: boolean;
  engine: ImportEngine;
  onClose: () => void;
  onAddManually: (title: string) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const status = engine.job ? engine.job.status : "idle";
  const tall = status === "found" || status === "importing" || status === "done";
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-8"
      style={{ background: "rgba(8,6,4,0.66)" }}
      onClick={onClose}
    >
      <div
        className="flex w-[640px] max-w-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-line-2 bg-surface shadow-[var(--shadow-pop)]"
        style={{ maxHeight: tall ? "86vh" : undefined, animation: "ds-modalin .3s cubic-bezier(.2,.8,.2,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end px-4 pt-[14px]">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-[34px] w-[34px] place-items-center rounded-pill border-0 bg-surface-2 text-text-dim transition-colors hover:bg-surface-3"
          >
            <Icon name="close" size={17} />
          </button>
        </div>
        <BatchPanel
          variant="desktop"
          engine={engine}
          onClose={onClose}
          onAddManually={onAddManually}
        />
      </div>
    </div>
  );
}

// ---------- mobile full-screen sheet ----------
export function BatchImportSheet({
  open,
  engine,
  onClose,
  onAddManually,
}: {
  open: boolean;
  engine: ImportEngine;
  onClose: () => void;
  onAddManually: (title: string) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-bg" style={{ animation: "ds-modalin .26s cubic-bezier(.2,.8,.2,1) both" }}>
      <div className="flex shrink-0 items-center justify-between px-5 pt-[var(--safe-top)] pb-[6px]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-[38px] w-[38px] place-items-center rounded-pill bg-surface-2 text-text-dim"
        >
          <Icon name="close" size={17} />
        </button>
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          Batch import
        </div>
        <div className="w-[38px]" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <BatchPanel
          variant="mobile"
          engine={engine}
          onClose={onClose}
          onAddManually={onAddManually}
        />
      </div>
    </div>
  );
}

// ---------- persistent progress dock ----------
export function ImportDock({
  engine,
  onOpen,
  variant,
}: {
  engine: ImportEngine;
  onOpen: () => void;
  variant: "mobile" | "desktop";
}) {
  const job = engine.job;
  if (!biActive(job) || !job || job.status === "idle" || job.status === "empty") return null;
  const c = biCounts(job);
  const analyzing = job.status === "analyzing";
  const found = job.status === "found";
  const done = job.status === "done";
  const label = analyzing
    ? "Analyzing…"
    : found
      ? `Found ${c.total} — confirm`
      : done
        ? `Imported ${c.imported} of ${c.total}`
        : `Importing ${c.imported} of ${c.total}`;
  const busy = analyzing || job.status === "importing";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-[11px] rounded-[var(--radius-md)] border border-accent-line bg-surface px-[13px] py-[11px] text-left shadow-[0_6px_18px_-10px_rgba(0,0,0,0.5)] transition-[transform,background] hover:bg-surface-2 active:scale-[0.99]"
      style={
        variant === "mobile"
          ? {
              background: "color-mix(in srgb, var(--surface) 92%, transparent)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              animation: "ds-rise .3s cubic-bezier(.2,.7,.2,1) both",
            }
          : { animation: "ds-rise .3s cubic-bezier(.2,.7,.2,1) both" }
      }
    >
      <span className="flex shrink-0">
        {busy ? (
          <span
            className="inline-block h-[17px] w-[17px] rounded-full border-[2.5px] border-accent-line border-t-accent"
            style={{ animation: "ds-spin .7s linear infinite" }}
          />
        ) : (
          <span
            className="grid h-5 w-5 place-items-center rounded-pill"
            style={{ background: done && !c.failed ? "var(--sage)" : "var(--accent)" }}
          >
            <Icon name={found ? "arrowR" : "check"} size={13} style={{ color: "#10140E" }} />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-[13px] font-semibold text-text">{label}</div>
        {(job.status === "importing" || done) && (
          <div className="mt-[5px]">
            <Track
              pct={biPct(c)}
              height={4}
              color={done ? (c.failed ? "var(--gold)" : "var(--sage)") : "var(--accent)"}
            />
          </div>
        )}
      </div>
      <Icon name="chevR" size={15} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
    </button>
  );
}
