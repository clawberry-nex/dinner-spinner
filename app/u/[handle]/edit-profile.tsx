"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/app/_components/ui";

// Mirror of lib/auth-helpers::HANDLE_REGEX. Kept inline so this client
// bundle doesn't drag in the server-only auth helpers. Server is still
// the source of truth — this just gives the user a fast inline error.
const HANDLE_REGEX = /^[a-z0-9_-]{3,30}$/;
const BIO_MAX = 160;

type Props = {
  initial: {
    handle: string;
    bio: string | null;
    handleLocked: boolean;
  };
};

/**
 * Inline edit form for the owner's profile. Renders as a small "Edit profile"
 * button that expands into a form. Handle field is disabled (with a tooltip)
 * once the user has used their one-time rename. Saves via PATCH /api/me/profile
 * and refreshes the route — if the handle changed, that takes the user to the
 * new URL via /me-style redirect logic done client-side here.
 */
export default function EditProfile({ initial }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState(initial.handle);
  const [bio, setBio] = useState(initial.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Edit profile
      </Button>
    );
  }

  const cancel = () => {
    setOpen(false);
    setHandle(initial.handle);
    setBio(initial.bio ?? "");
    setErr(null);
  };

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
      // If the handle changed, jump to the new URL. Otherwise refresh in place.
      if (handleChanged) {
        router.push(`/u/${handle}`);
      } else {
        router.refresh();
      }
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-lg border border-rule bg-paper p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
        Edit profile
      </div>

      <label className="mt-3 flex flex-col gap-1 text-sm">
        <span className="font-medium">
          Handle{" "}
          {initial.handleLocked && (
            <span className="text-xs font-normal text-ink-3">
              (locked — handles can only be changed once)
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-ink-3" style={{ fontFamily: "var(--font-mono)" }}>@</span>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
            disabled={initial.handleLocked || busy}
            spellCheck={false}
            autoCapitalize="off"
            maxLength={30}
            className="flex-1 rounded border border-rule bg-bg px-2 py-1 text-sm font-mono disabled:opacity-60"
          />
        </div>
        {!initial.handleLocked && (
          <span className="text-xs text-ink-3">
            You can change this once. Existing share links to your old handle will 404.
          </span>
        )}
      </label>

      <label className="mt-3 flex flex-col gap-1 text-sm">
        <span className="font-medium">
          Bio{" "}
          <span className="text-xs font-normal text-ink-3">
            ({bio.length}/{BIO_MAX})
          </span>
        </span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          disabled={busy}
          maxLength={BIO_MAX}
          rows={2}
          className="resize-y rounded border border-rule bg-bg px-2 py-1 text-sm disabled:opacity-60"
          placeholder="A one-line description for your profile."
        />
      </label>

      {err && <div className="mt-3 text-sm text-red-600">{err}</div>}

      <div className="mt-4 flex gap-2">
        <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="ink" size="sm" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
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
      return "You've already used your one-time handle change.";
    case "bio_too_long":
      return `Bio is too long (max ${BIO_MAX} chars).`;
    default:
      return "Couldn't save profile.";
  }
}
