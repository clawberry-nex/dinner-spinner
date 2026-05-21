"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DishInput } from "@/lib/types";
import DishForm from "@/app/_components/dish-form";
import { AppHeader } from "@/app/_components/app-header";
import { Button } from "@/app/_components/ui";
import { IngestInput } from "./ingest-input";

export default function AddPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"ingest" | "manual">("ingest");
  const [prefill, setPrefill] = useState<DishInput | undefined>();

  function onIngested(parsed: DishInput) {
    setPrefill(parsed);
    setMode("manual");
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <AppHeader title="Add recipe" />
      <div className="flex-1 overflow-auto pb-20">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {mode === "ingest" ? (
            <>
              <IngestInput onParsed={onIngested} />
              <p className="text-center text-sm text-zinc-500">
                Or{" "}
                <button
                  type="button"
                  onClick={() => setMode("manual")}
                  className="text-emerald-600 hover:underline"
                >
                  fill in manually
                </button>
              </p>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setMode("ingest")}>
                ← Back to ingest
              </Button>
              <DishForm
                prefillDraft={prefill}
                onSaved={(dish) => router.push(`/dishes/${dish.id}`)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
