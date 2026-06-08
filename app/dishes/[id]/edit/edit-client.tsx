"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dish } from "@/lib/types";
import DishForm from "@/app/_components/dish-form";
import { Icon } from "@/app/_components/icon";

export default function EditDishClient({ dish }: { dish: Dish }) {
  const router = useRouter();
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function del() {
    setDeleting(true);
    const res = await fetch(`/api/dishes/${dish.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/");
    } else {
      setDeleting(false);
    }
  }

  return (
    <>
      {/* Header section — no AppHeader brand; the shell owns the chrome.
          A back affordance + eyebrow + dish title, matching the V2 add page. */}
      <div className="mb-6 flex items-start gap-[14px]">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="mt-[2px] grid h-9 w-9 shrink-0 place-items-center rounded-pill border-0 bg-surface-2 text-text-dim transition-colors hover:bg-surface-3"
        >
          <Icon name="back" size={18} />
        </button>
        <div className="min-w-0">
          <div className="mb-[8px] text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
            Edit recipe
          </div>
          <h1
            className="m-0 font-medium leading-[1.06] tracking-[-0.02em] text-text"
            style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(26px,5vw,38px)" }}
          >
            {dish.title}
          </h1>
        </div>
      </div>

      <DishForm
        initial={dish}
        onSaved={(saved) => router.push(`/dishes/${saved.id}`)}
      />

      {/* Danger zone — two-step confirm, mirroring the V2 prototype. */}
      <div className="mt-7 border-t border-line pt-[18px]">
        <div
          className="mb-[10px] text-[11px] font-semibold uppercase tracking-[0.18em] text-rose"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          Danger zone
        </div>
        {confirmDel ? (
          <div
            className="rounded-[var(--radius-md)] border bg-surface p-[14px] shadow-[var(--shadow-card)]"
            style={{ borderColor: "var(--rose)" }}
          >
            <div className="mb-[12px] text-[13.5px] text-text">
              Delete &ldquo;{dish.title}&rdquo; for good? This can&rsquo;t be undone.
            </div>
            <div className="flex gap-[10px]">
              <button
                type="button"
                onClick={() => setConfirmDel(false)}
                disabled={deleting}
                className="flex-1 rounded-pill border border-line bg-surface-2 px-4 py-[10px] text-[14px] font-semibold text-text transition-colors hover:bg-surface-3 disabled:opacity-50"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={del}
                disabled={deleting}
                className="flex-1 rounded-pill px-4 py-[10px] text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--rose)", fontFamily: "var(--font-sans)" }}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDel(true)}
            className="flex w-full items-center justify-center gap-[8px] rounded-[var(--radius-md)] border bg-transparent px-4 py-[12px] text-[14px] font-semibold text-rose transition-colors hover:bg-rose-tint"
            style={{ borderColor: "var(--rose)", fontFamily: "var(--font-sans)" }}
          >
            <Icon name="close" size={16} />
            Delete this recipe
          </button>
        )}
      </div>
    </>
  );
}
