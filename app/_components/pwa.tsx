"use client";

import { useEffect, useState } from "react";
import {
  isIOS,
  isStandalone,
  shouldShowPrompt,
  writeDismissed,
} from "@/lib/install-prompt";

// Minimal BeforeInstallPromptEvent shape (not in lib.dom yet).
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function Pwa() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [variant, setVariant] = useState<"none" | "android" | "ios">("none");

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Register service worker in production. Dev (next dev) doesn't
    // build /sw.js, so skip registration there to avoid 404 spam.
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js", { scope: "/" })
          .catch(() => {});
      });
    }

    const standaloneMatch =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(display-mode: standalone)")
        : null;
    const iosStandalone =
      (window.navigator as Navigator & { standalone?: boolean }).standalone;
    const installed = isStandalone(standaloneMatch, iosStandalone);

    if (!shouldShowPrompt({ installed })) return;

    const ios = isIOS(window.navigator.userAgent, window.navigator.maxTouchPoints);
    if (ios) {
      setVariant("ios");
      return;
    }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVariant("android");
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    const onInstalled = () => {
      setVariant("none");
      setDeferred(null);
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (variant === "none") return null;

  const dismiss = () => {
    writeDismissed();
    setVariant("none");
    setDeferred(null);
  };

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } finally {
      setVariant("none");
      setDeferred(null);
    }
  };

  return (
    <div
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-md border border-rule bg-paper p-3 text-[13px] text-ink shadow-lg sm:bottom-4"
      role="dialog"
      aria-label="Install Dinner Spinner"
    >
      {variant === "android" ? (
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="font-medium">Install Dinner Spinner</div>
            <div className="text-ink-3 text-[12px]">Add to your home screen for one-tap access.</div>
          </div>
          <button
            type="button"
            onClick={install}
            className="rounded-pill border border-accent bg-accent px-3 py-[6px] text-[12px] font-medium text-accent-ink"
          >
            Install
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss install prompt"
            className="rounded-pill border border-rule px-2 py-[6px] text-[12px] text-ink-2 hover:border-ink-3"
          >
            ×
          </button>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="font-medium">Add to Home Screen</div>
            <div className="text-ink-3 text-[12px]">
              Tap <span aria-hidden>⬆︎</span> Share, then &ldquo;Add to Home Screen&rdquo;.
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss install prompt"
            className="rounded-pill border border-rule px-2 py-[6px] text-[12px] text-ink-2 hover:border-ink-3"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
