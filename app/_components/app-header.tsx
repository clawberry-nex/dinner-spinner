"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { BrandMark } from "./ui";
import { Icon } from "./icon";

type Props = { back?: boolean | string; title?: string; subtitle?: string; right?: ReactNode; flat?: boolean };

export function AppHeader({ back, title, subtitle, right, flat }: Props) {
  const router = useRouter();

  const onBack = () => {
    if (typeof back === "string") router.push(back);
    else router.back();
  };

  return (
    <div
      className={[
        "relative z-[3] w-full bg-bg",
        flat ? "" : "border-b border-rule-soft",
      ].join(" ")}
    >
      <div className="mx-auto flex min-h-12 w-full max-w-6xl items-center gap-[10px] px-4 pt-[10px] pb-3">
        {back ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="grid h-9 w-9 place-items-center rounded-pill border border-rule bg-paper text-ink"
          >
            <Icon name="chev-left" size={18} />
          </button>
        ) : (
          <Link href="/" className="flex items-center gap-2">
            <BrandMark size={30} />
            <span className="text-lg font-semibold text-ink" style={{ fontFamily: "var(--font-disp)", letterSpacing: -0.3 }}>
              Dinner Spinner
            </span>
          </Link>
        )}
        <div className="flex-1">
          {title && <div className="text-[14px] font-medium text-ink-2">{title}</div>}
          {subtitle && <div className="text-[12px] text-ink-3">{subtitle}</div>}
        </div>
        {right}
      </div>
    </div>
  );
}
