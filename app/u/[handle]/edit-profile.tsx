"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/_components/icon";

// Mirror of lib/auth-helpers::HANDLE_REGEX. Kept inline so this client
// bundle doesn't drag in the server-only auth helpers. Server is still
// the source of truth — this just gives the user a fast inline error.
const HANDLE_REGEX = /^[a-z0-9_-]{3,30}$/;
const BIO_MAX = 160;

type Initial = {
  handle: string;
  bio: string | null;
  handleLocked: boolean;
};

type Props = {
  initial: Initial;
  // "inline" (default): a small button that expands into a form (legacy use).
  // "modal": rendered already-open as a centered dialog; parent owns mount via
  // an `onClose` callback (the V2 profile header uses this).
  mode?: "inline" | "modal";
  onClose?: () => void;
};

/**
 * Owner profile editor. Saves the one-time-editable `handle` + `bio` via
 * PATCH /api/me/profile. The handle field locks once the user has used their
 * single rename (`handleLocked`), with a warning that old share links 404.
 * Name editing is intentionally absent — the API only persists handle + bio
 * (the display name comes from the auth provider).
 */
export default function EditProfile({ initial, mode = "inline", onClose }: Props) {
  const [open, setOpen] = useState(mode === "modal");

  if (mode === "inline" && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-pill border border-line bg-transparent px-[14px] py-[8px] text-[13px] font-semibold text-text transition-colors hover:border-line-2"
      >
        <Icon name="edit" size={15} />
        Edit profile
      </button>
    );
  }

  const close = () => {
    setOpen(false);
    onClose?.();
  };

  if (mode === "modal") {
    return <EditModal initial={initial} onClose={close} />;
  }
  // inline-open: render the form card in place (no overlay).
  return (
    <div className="w-full max-w-md">
      <EditForm initial={initial} onClose={close} />
    </div>
  );
}

// Centered modal wrapper (V2 styling) for the owner header's edit affordance.
function EditModal({ initial, onClose }: { initial: Initial; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/55" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal
        className="fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[var(--radius-xl)] border border-line bg-surface p-[26px] shadow-[var(--shadow-pop)]"
        style={{ animation: "ds-rise .28s cubic-bezier(.2,.7,.2,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              Your kitchen
            </div>
            <h2 className="m-0 text-[24px] font-semibold leading-[1.1] text-text" style={{ fontFamily: "var(--font-serif)" }}>
              Edit profile
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-pill bg-surface-2 text-text-dim transition-colors hover:text-text"
          >
            <Icon name="close" size={17} />
          </button>
        </div>
        <EditForm initial={initial} onClose={onClose} />
      </div>
    </>
  );
}

// The shared handle + bio form. Used by both the inline card and the modal.
function EditForm({ initial, onClose }: { initial: Initial; onClose: () => void }) {
  const router = useRouter();
  const [handle, setHandle] = useState(initial.handle);
  const [bio, setBio] = useState(initial.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    const handleChanged = handle !== initial.handle;
    if (handleChanged && !HANDLE_REGEX.test(handle)) {
      setErr("Handle must be 3–30 chars: lowercase letters, digits, dash, underscore.");
      return;
    }
    if (bio.length > BIO_MAX) {
      setErr(`Bio is too long (max ${BIO_MAX} chars).`);
      return;
    }
    setBusy(true);
    const body: { handle?: string; bio: string | null } = { bio: bio.trim() || null };
    if (handleChanged) body.handle = handle;
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(messageForError(data.error));
        return;
      }
      // Handle change moves the user to the new URL; otherwise refresh in place.
      if (handleChanged) {
        router.push(`/u/${handle}`);
      } else {
        router.refresh();
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "mt-[6px] w-full rounded-[var(--radius-md)] border border-line bg-surface-2 px-[13px] py-[10px] text-[14.5px] text-text placeholder:text-text-faint transition-colors focus:border-accent-line focus:outline-none disabled:opacity-60";

  return (
    <div>
      <label className="mt-[22px] block">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-faint">
          Handle
          {initial.handleLocked && (
            <span className="ml-2 font-normal normal-case tracking-normal text-text-faint">
              (locked — handles change only once)
            </span>
          )}
        </span>
        <div className="relative">
          <span
            className="pointer-events-none absolute left-[13px] top-1/2 -translate-y-1/2 text-text-faint"
            style={{ fontFamily: "var(--font-mono)", fontSize: 14.5 }}
          >
            @
          </span>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
            disabled={initial.handleLocked || busy}
            spellCheck={false}
            autoCapitalize="off"
            maxLength={30}
            className={`${inputCls} pl-[28px]`}
            style={{ fontFamily: "var(--font-mono)" }}
          />
        </div>
        {!initial.handleLocked && (
          <span className="mt-[6px] block text-[12px] text-text-faint">
            You can change this once. Existing share links to your old handle will 404.
          </span>
        )}
      </label>

      <label className="mt-[14px] block">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-faint">
          Bio
          <span className="ml-2 font-normal normal-case tracking-normal text-text-faint">
            ({bio.length}/{BIO_MAX})
          </span>
        </span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          disabled={busy}
          maxLength={BIO_MAX}
          rows={3}
          className={`${inputCls} resize-y`}
          placeholder="A line about how you cook."
        />
      </label>

      {err && <div className="mt-3 text-[13px] text-rose">{err}</div>}

      <div className="mt-5 flex gap-[10px]">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-pill border border-line bg-transparent px-[18px] py-[10px] text-[13.5px] font-semibold text-text-dim transition-colors hover:border-line-2 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-2 rounded-pill bg-accent px-[18px] py-[10px] text-[13.5px] font-semibold text-accent-ink transition-opacity hover:bg-accent-2 disabled:opacity-50"
        >
          {busy ? "Saving…" : (<><Icon name="check" size={17} style={{ color: "var(--accent-ink)" }} />Save profile</>)}
        </button>
      </div>
    </div>
  );
}

function messageForError(code: string | undefined): string {
  switch (code) {
    case "handle_invalid":
      return "Handle must be 3–30 chars: lowercase letters, digits, dash, underscore.";
    case "handle_taken":
      return "That handle is already taken.";
    case "handle_already_changed":
      return "You’ve already used your one-time handle change.";
    case "bio_too_long":
      return `Bio is too long (max ${BIO_MAX} chars).`;
    default:
      return "Couldn’t save profile.";
  }
}
