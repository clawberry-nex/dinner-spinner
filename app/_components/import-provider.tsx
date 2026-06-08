"use client";

// ============================================================
// import-provider.tsx — hoists the batch-import engine to the app shell so a
// running import survives navigation (the shell doesn't unmount on route
// changes the way a page does). It also resumes any in-flight import on load
// (recovering one that was paused by a reload or by leaving /add before the
// photos finished), and renders the progress dock globally — above the bottom
// nav on mobile, bottom-right on desktop. /add consumes the engine + panel
// state from here via useImport().
// ============================================================

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useToast } from "./ui";
import { useImportEngine, biActive, type ImportEngine } from "../add/batch-import";
import { ImportDock } from "../add/batch-panel";

type ImportCtx = {
  engine: ImportEngine;
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
};

const Ctx = createContext<ImportCtx | null>(null);

export function useImport(): ImportCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useImport must be used within <ImportProvider>");
  return c;
}

export function ImportProvider({
  children,
  isSignedIn,
}: {
  children: ReactNode;
  isSignedIn: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const { show, el: toastEl } = useToast();
  const engine = useImportEngine(show);
  const [panelOpen, setPanelOpen] = useState(false);
  const resumedRef = useRef(false);

  // Resume an in-flight import once per app load. The engine itself survives
  // in-session navigation (it lives here, not on the page), so this only fires
  // after a full reload / fresh session — but that's exactly when the importId
  // ref was lost and the import would otherwise stall.
  useEffect(() => {
    if (!isSignedIn || resumedRef.current) return;
    resumedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/import");
        if (!res.ok) return;
        const data = await res.json();
        if (data?.active?.importId) engine.resume(data.active.importId);
      } catch {
        /* offline / transient — nothing to resume */
      }
    })();
    // engine.resume is stable; run once when signed-in status is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  const openPanel = () => {
    if (pathname !== "/add") router.push("/add");
    setPanelOpen(true);
  };
  const closePanel = () => setPanelOpen(false);

  // The dock floats globally while an import is active — except on immersive
  // cook mode and the open panel itself.
  const immersive = pathname.includes("/cook");
  const showDock = isSignedIn && !immersive && biActive(engine.job) && !panelOpen;

  return (
    <Ctx.Provider value={{ engine, panelOpen, openPanel, closePanel }}>
      {children}
      {showDock && (
        <>
          <div className="fixed inset-x-4 z-40 lg:hidden" style={{ bottom: "calc(var(--nav-h) + 8px)" }}>
            <ImportDock engine={engine} onOpen={openPanel} variant="mobile" />
          </div>
          <div className="fixed bottom-6 right-6 z-40 hidden w-[360px] lg:block">
            <ImportDock engine={engine} onOpen={openPanel} variant="desktop" />
          </div>
        </>
      )}
      {toastEl}
    </Ctx.Provider>
  );
}
