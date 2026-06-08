"use client";

import type { ReactNode } from "react";
import { BrandMark } from "@/app/_components/ui";
import { Icon } from "@/app/_components/icon";

// Shared input styling for the auth forms — raised surface-2 fill, hairline
// border, accent focus ring, cream text. Mirrors the prototype's `authInput`
// and the dish-form input convention.
export const authInputCls =
  "w-full rounded-[var(--radius-md)] border border-line bg-surface-2 px-[16px] py-[15px] text-[15.5px] text-text placeholder:text-text-faint transition-colors focus:border-accent-line focus:outline-none";

// Hero photo for the desktop split-hero. A stable dish image from the V2
// reference set, dimmed under a warm gradient so the form panel reads first.
const HERO_PHOTO =
  "https://znw6yfxpkg7c0mor.public.blob.vercel-storage.com/dishes/34/zMzR_r3qsDn5.webp";

export function AuthError({ children }: { children: ReactNode }) {
  return (
    <div className="mt-[6px] flex items-center gap-[7px] text-[13px] text-rose">
      <Icon name="close" size={15} style={{ color: "var(--rose)", flexShrink: 0 }} />
      <span>{children}</span>
    </div>
  );
}

export function GoogleButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-[52px] w-full items-center justify-center gap-[10px] rounded-[var(--radius-md)] border border-line-2 bg-surface text-[15px] font-medium text-text transition-colors hover:bg-surface-2"
      style={{ letterSpacing: 0.2 }}
    >
      <GoogleG />
      Continue with Google
    </button>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6c1.9-5.6 7.1-9.8 13.7-9.8z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-4 6.9-9.9 6.9-17.4z"
      />
      <path
        fill="#FBBC05"
        d="M10.3 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.3.8-4.7l-7.8-6C.9 16.6 0 20.2 0 24s.9 7.4 2.5 10.7l7.8-6z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.2 0 11.5-2 15.3-5.6l-7.3-5.7c-2 1.4-4.6 2.3-8 2.3-6.6 0-11.8-4.2-13.7-9.8l-7.8 6C6.4 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-[11px]">
      <BrandMark size={56} />
      <span
        className="font-semibold tracking-[-0.015em] text-text"
        style={{ fontFamily: "var(--font-serif)", fontSize: 26 }}
      >
        Dinner Spinner
      </span>
    </div>
  );
}

// AuthShell — standalone (anon) auth layout. Desktop (≥lg): a split hero — warm
// gradient + dish photo on the left, the form panel on the right. Mobile: a
// single column with a compact warm hero above the form. `heading`/`copy` label
// the form panel; `children` is the auth form (Google button, inputs, submit,
// mode link).
export function AuthShell({
  heading,
  copy,
  children,
}: {
  heading: string;
  copy: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-bg">
      {/* ── Desktop hero (≥lg): warm gradient + dimmed dish photo ── */}
      <div className="relative hidden flex-1 overflow-hidden lg:block">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 28% 18%, var(--accent-deep), #1A1108 58%, #0C0A08)",
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={HERO_PHOTO}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-[0.46]"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(12,10,8,0.55) 0%, transparent 32%, rgba(12,10,8,0.9) 100%)",
          }}
        />
        <div className="relative flex h-full flex-col justify-between p-[46px_52px]">
          <Wordmark />
          <div>
            <h1
              className="m-0 font-semibold leading-[1.0] tracking-[-0.02em] text-text"
              style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(40px,4.4vw,60px)", maxWidth: 620 }}
            >
              What&rsquo;s for dinner, decided.
            </h1>
            <p
              className="mt-5 leading-[1.5] text-text-dim"
              style={{ fontSize: 18, maxWidth: 480 }}
            >
              Your recipes, a nightly suggestion you can trust, and one shopping
              list that lands on your phone.
            </p>
          </div>
        </div>
      </div>

      {/* ── Form panel (both breakpoints; full width on mobile) ── */}
      <div className="flex w-full flex-col overflow-y-auto overflow-x-hidden lg:w-[clamp(420px,40%,540px)] lg:flex-none lg:border-l lg:border-line">
        {/* Mobile compact hero — hidden on desktop (the split hero covers it). */}
        <div className="relative overflow-hidden px-[30px] pt-[calc(var(--safe-top)+16px)] pb-[26px] lg:hidden">
          <div
            className="pointer-events-none absolute inset-0 opacity-50"
            style={{
              background:
                "radial-gradient(120% 70% at 70% 0%, var(--accent-tint), transparent 55%)",
            }}
          />
          <div className="relative">
            <Wordmark />
            <h1
              className="m-0 mt-[22px] font-semibold leading-[1.08] tracking-[-0.015em] text-text"
              style={{ fontFamily: "var(--font-serif)", fontSize: 32 }}
            >
              What&rsquo;s for dinner,
              <br />
              decided.
            </h1>
            <p
              className="mt-3 leading-[1.55] text-text-dim"
              style={{ fontSize: 14.5, maxWidth: 300 }}
            >
              Your recipes, a nightly suggestion you can trust, and one shopping
              list that lands on your phone.
            </p>
          </div>
        </div>

        {/* The form itself, centered on desktop. */}
        <div className="flex flex-1 items-center justify-center px-[26px] pb-[34px] pt-[8px] lg:p-[40px_44px]">
          <div className="w-full max-w-[360px]">
            <h2
              className="m-0 hidden font-semibold tracking-[-0.01em] text-text lg:block"
              style={{ fontFamily: "var(--font-serif)", fontSize: 30 }}
            >
              {heading}
            </h2>
            <p className="mt-2 hidden text-[14.5px] leading-[1.5] text-text-dim lg:block">
              {copy}
            </p>
            <div className="lg:mt-6">{children}</div>
          </div>
        </div>

        <div className="px-[30px] pb-[calc(var(--safe-top))] pt-2 text-center text-[11.5px] text-text-faint lg:hidden">
          Installable to your home screen · works offline mid-recipe
        </div>
      </div>
    </div>
  );
}
