"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DishForm from "@/app/_components/dish-form";
import { Icon } from "@/app/_components/icon";
import { IngestInput } from "./ingest-input";
import { useImport } from "@/app/_components/import-provider";
import { BatchImportModal, BatchImportSheet } from "./batch-panel";

type Mode = "ingest" | "manual";

export default function AddPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("ingest");
  // When the manual form is opened with a title pre-seeded (e.g. from a failed
  // batch import row choosing "add manually"). Keyed into <DishForm> so a new
  // seed remounts the form.
  const [seed, setSeed] = useState<{ title: string; key: number } | null>(null);

  // The batch-import engine lives in the app shell (ImportProvider) so a
  // running import survives navigation; /add just drives the panel + reads it.
  const { engine, panelOpen, openPanel, closePanel } = useImport();

  const openManualWith = (title: string) => {
    setSeed({ title, key: Date.now() });
    setMode("manual");
    closePanel();
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <div className="relative flex-1 overflow-y-auto overflow-x-hidden pb-24 lg:pb-10">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-5 pt-[var(--safe-top)] lg:px-10">
          {/* Header section — no AppHeader; the shell owns the brand chrome. */}
          <div className="mb-[10px] text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
            Add a recipe
          </div>
          <h1
            className="m-0 font-medium leading-[1.04] tracking-[-0.02em] text-text"
            style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(30px,6vw,42px)" }}
          >
            {mode === "ingest" ? "Paste, link, or snap it." : "Write it yourself"}
          </h1>
          <p className="mt-2 max-w-[52ch] text-[13.5px] leading-[1.5] text-text-dim lg:text-[15px]">
            {mode === "ingest"
              ? "Drop in recipe text, a URL, a description — or a photo of a cookbook page. Claude structures the whole thing and saves the dish."
              : "Fill in the details by hand. Structured fields keep scaling, shopping, and diet detection working."}
          </p>

          {/* Mode toggle — segmented control. */}
          <div className="mt-5 flex gap-1 rounded-[var(--radius-md)] border border-line bg-surface-2 p-1">
            <SegButton active={mode === "ingest"} onClick={() => { setMode("ingest"); setSeed(null); }}>
              <Icon name="sparkle" size={15} />
              Magic ingest
            </SegButton>
            <SegButton active={mode === "manual"} onClick={() => setMode("manual")}>
              <Icon name="edit" size={15} />
              Write it myself
            </SegButton>
          </div>

          {/* Body. */}
          <div className="mt-6">
            {mode === "ingest" ? (
              <>
                <IngestInput />

                {/* Batch import entry. */}
                <button
                  type="button"
                  onClick={openPanel}
                  className="mt-[18px] flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-line bg-surface-2 px-[15px] py-[13px] text-left transition-colors hover:border-accent-line hover:bg-accent-tint"
                >
                  <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] bg-surface-3">
                    <Icon name="list" size={19} style={{ color: "var(--accent-2)" }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-[14px] font-semibold text-text">Batch import</span>
                    <span className="mt-[1px] block text-[12.5px] text-text-faint">
                      Upload or paste a document — import many recipes at once
                    </span>
                  </span>
                  <Icon name="chevR" size={17} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
                </button>
              </>
            ) : (
              <DishForm
                key={seed ? `seed-${seed.key}` : "manual"}
                prefillDraft={seed ? { title: seed.title, baseServings: 4, tags: [], ingredients: [] } : undefined}
                onSaved={(dish) => router.push(`/dishes/${dish.id}`)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Batch panel: desktop modal (≥lg) · mobile sheet (<lg). Both render the
          same <BatchPanel>; we mount the right wrapper per breakpoint. The
          engine + open state come from the shell-level ImportProvider, so the
          import keeps running (and the dock stays visible) across navigation. */}
      <div className="hidden lg:contents">
        <BatchImportModal
          open={panelOpen}
          engine={engine}
          onClose={closePanel}
          onAddManually={openManualWith}
        />
      </div>
      <div className="contents lg:hidden">
        <BatchImportSheet
          open={panelOpen}
          engine={engine}
          onClose={closePanel}
          onAddManually={openManualWith}
        />
      </div>
    </div>
  );
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-sm)] px-3 py-[10px] text-[14px] font-semibold transition-colors",
        active
          ? "bg-surface text-accent-2 shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
          : "bg-transparent text-text-dim hover:text-text",
      ].join(" ")}
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {children}
    </button>
  );
}
