"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import type { Dish } from "@/lib/types";
import { STANDARD_INGREDIENTS } from "@/lib/vocabulary";
import { Button } from "@/app/_components/ui";

type Props = {
  user: {
    email: string;
    name: string | null;
    image: string | null;
    hasPassword: boolean;
    isSeedOwner: boolean;
  };
};

export default function SettingsClient({ user }: Props) {
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [pantryDefaults, setPantryDefaults] = useState<string[]>([]);
  const [newPantryName, setNewPantryName] = useState("");

  // Todoist section.
  const [todoistHasToken, setTodoistHasToken] = useState(false);
  const [todoistProject, setTodoistProject] = useState<string | null>(null);
  const [todoistTokenInput, setTodoistTokenInput] = useState("");
  const [todoistProjectInput, setTodoistProjectInput] = useState("");
  const [todoistMsg, setTodoistMsg] = useState<string | null>(null);

  // Password section.
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  // Bulk image gen.
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  // Backup.
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const ingredientNameOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of [...STANDARD_INGREDIENTS, ...existingNames]) {
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [existingNames]);

  async function reload() {
    const [dRes, nRes, pRes, tRes] = await Promise.all([
      fetch("/api/dishes"),
      fetch("/api/ingredient-names"),
      fetch("/api/pantry-defaults"),
      fetch("/api/me/todoist"),
    ]);
    if (dRes.ok) setDishes((await dRes.json()) as Dish[]);
    if (nRes.ok) setExistingNames((await nRes.json()) as string[]);
    if (pRes.ok) setPantryDefaults((await pRes.json()) as string[]);
    if (tRes.ok) {
      const td = (await tRes.json()) as {
        hasToken: boolean;
        projectName: string | null;
      };
      setTodoistHasToken(td.hasToken);
      setTodoistProject(td.projectName);
      setTodoistProjectInput(td.projectName ?? "");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload().catch(() => {});
  }, []);

  async function saveTodoist(e: React.FormEvent) {
    e.preventDefault();
    setTodoistMsg(null);
    const token = todoistTokenInput.trim() || null;
    const projectName = todoistProjectInput.trim() || null;
    const res = await fetch("/api/me/todoist", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, projectName }),
    });
    if (res.ok) {
      setTodoistMsg("Saved.");
      setTodoistTokenInput("");
      await reload();
    } else {
      setTodoistMsg(`HTTP ${res.status}`);
    }
  }

  async function clearTodoist() {
    if (!confirm("Clear your Todoist token and project?")) return;
    setTodoistMsg(null);
    const res = await fetch("/api/me/todoist", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: null, projectName: null }),
    });
    if (res.ok) {
      setTodoistMsg("Cleared.");
      setTodoistTokenInput("");
      setTodoistProjectInput("");
      await reload();
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    const res = await fetch("/api/me/password", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current: pwCurrent, next: pwNext }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok) {
      setPwMsg("Password changed.");
      setPwCurrent("");
      setPwNext("");
    } else {
      setPwMsg(messageForPwError(data.error));
    }
  }

  async function del(id: number) {
    if (!confirm("Delete this dish?")) return;
    const res = await fetch(`/api/dishes/${id}`, { method: "DELETE" });
    if (res.ok) reload();
  }

  async function copyDish(d: Dish) {
    const payload = {
      title: `${d.title} (copy)`,
      subtitle: d.subtitle ?? null,
      recipe: d.recipe ?? null,
      notes: d.notes ?? null,
      tags: d.tags,
      ingredients: d.ingredients,
      baseServings: d.baseServings,
      favorite: false,
      imageUrl: null,
      emoji: d.emoji ?? null,
      accent: d.accent ?? null,
      imageDescription: d.imageDescription ?? null,
    };
    const res = await fetch("/api/dishes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const created = (await res.json()) as Dish;
      window.location.href = `/dishes/${created.id}/edit`;
    }
  }

  async function addPantryDefault(name: string) {
    const normalized = name.toLowerCase().trim();
    if (!normalized) return;
    const res = await fetch("/api/pantry-defaults", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: normalized }),
    });
    if (res.ok) {
      setPantryDefaults((prev) =>
        [...new Set([...prev, normalized])].sort((a, b) => a.localeCompare(b)),
      );
    }
  }

  async function removePantryDefault(name: string) {
    const res = await fetch(
      `/api/pantry-defaults?name=${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      setPantryDefaults((prev) => prev.filter((n) => n !== name));
    }
  }

  async function bulkGenerate() {
    if (!confirm("Generate AI photos for every dish missing one? This will use credits.")) return;
    setBulkRunning(true);
    setBulkMsg("Generating…");
    try {
      const res = await fetch("/api/dishes/images/backfill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ overwrite: false }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: number;
        failed?: Array<{ dishId: number; error: string }>;
        total?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const failedCount = data.failed?.length ?? 0;
      setBulkMsg(`Generated ${data.ok ?? 0} / ${data.total ?? 0}. ${failedCount} failed.`);
      await reload();
    } catch (err) {
      setBulkMsg(err instanceof Error ? err.message : "Bulk generation failed");
    } finally {
      setBulkRunning(false);
    }
  }

  async function downloadBackup() {
    setBackupMsg(null);
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setBackupMsg(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().slice(0, 10);
      a.download = `dinner-spinner-backup-${today}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBackupMsg("Downloaded.");
    } catch (err) {
      setBackupMsg(err instanceof Error ? err.message : "Download failed");
    }
  }

  async function importBackup(file: File) {
    setBackupMsg(null);
    setImporting(true);
    try {
      const text = await file.text();
      try {
        JSON.parse(text);
      } catch {
        setBackupMsg("Not valid JSON");
        return;
      }
      if (!confirm("Import this backup into your account?")) return;
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        counts?: { dishes: number; pantryNames: number; mealPlanEntries: number };
      };
      if (!res.ok || !data.ok) {
        setBackupMsg(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setBackupMsg(
        `Imported ${data.counts?.dishes ?? 0} dishes, ` +
          `${data.counts?.pantryNames ?? 0} pantry names, ` +
          `${data.counts?.mealPlanEntries ?? 0} meal-plan entries.`,
      );
      reload();
    } finally {
      setImporting(false);
    }
  }

  const todoistFallbackHint =
    user.isSeedOwner && !todoistHasToken && !todoistProject
      ? "Currently using TODOIST_API_TOKEN / TODOIST_PROJECT_NAME env fallback."
      : null;

  return (
    <>
      {/* Profile */}
      <section>
        <h2 className="mb-3 text-xl font-semibold">Profile</h2>
        <div className="flex items-center gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          {user.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt=""
              className="h-12 w-12 rounded-full border border-zinc-200 dark:border-zinc-800"
            />
          )}
          <div className="flex-1">
            {user.name && <div className="font-medium">{user.name}</div>}
            <div className="text-sm text-zinc-500">{user.email}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => signOut({ callbackUrl: "/auth/signin" })}
          >
            Sign out
          </Button>
        </div>
      </section>

      {/* Change password — only for accounts that have one. */}
      {user.hasPassword && (
        <section>
          <h2 className="mb-3 text-xl font-semibold">Change password</h2>
          <form
            onSubmit={changePassword}
            className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <input
              type="password"
              required
              placeholder="Current password"
              value={pwCurrent}
              onChange={(e) => setPwCurrent(e.target.value)}
              autoComplete="current-password"
              className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <input
              type="password"
              required
              minLength={8}
              placeholder="New password (min 8 chars)"
              value={pwNext}
              onChange={(e) => setPwNext(e.target.value)}
              autoComplete="new-password"
              className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm">
                Change password
              </Button>
              {pwMsg && <span className="text-sm text-zinc-600">{pwMsg}</span>}
            </div>
          </form>
        </section>
      )}

      {/* Todoist */}
      <section>
        <h2 className="mb-3 text-xl font-semibold">Todoist</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Paste your Todoist API token and the name of the project where the
          shopping list should land. {todoistFallbackHint}
        </p>
        <form
          onSubmit={saveTodoist}
          className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              API token{" "}
              {todoistHasToken && (
                <span className="text-xs font-normal text-emerald-600">(set)</span>
              )}
            </span>
            <input
              type="password"
              placeholder={todoistHasToken ? "Replace token…" : "Paste token"}
              value={todoistTokenInput}
              onChange={(e) => setTodoistTokenInput(e.target.value)}
              className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Project name</span>
            <input
              type="text"
              placeholder="Shopping"
              value={todoistProjectInput}
              onChange={(e) => setTodoistProjectInput(e.target.value)}
              className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm">
              Save
            </Button>
            {(todoistHasToken || todoistProject) && (
              <Button type="button" variant="ghost" size="sm" onClick={clearTodoist}>
                Clear
              </Button>
            )}
            {todoistMsg && <span className="text-sm text-zinc-600">{todoistMsg}</span>}
          </div>
        </form>
      </section>

      {/* Pantry defaults */}
      <section>
        <h2 className="mb-3 text-xl font-semibold">
          Pantry defaults ({pantryDefaults.length})
        </h2>
        <p className="mb-3 text-xs text-zinc-500">
          Ingredient names in this list auto-flag <code>pantry: true</code>{" "}
          when used in any dish. They&rsquo;re excluded from the shopping list
          and Todoist push. Match is case-insensitive, exact name (no fuzzy).
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addPantryDefault(newPantryName);
            setNewPantryName("");
          }}
          className="mb-3 flex gap-2"
        >
          <input
            list="ingredient-names-for-pantry"
            value={newPantryName}
            onChange={(e) => setNewPantryName(e.target.value)}
            placeholder="add pantry name…"
            className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={!newPantryName.trim()}
            className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-70"
          >
            Add
          </button>
        </form>
        <datalist id="ingredient-names-for-pantry">
          {ingredientNameOptions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {pantryDefaults.length === 0 ? (
          <p className="text-zinc-500">No pantry defaults yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {pantryDefaults.map((name) => (
              <span
                key={name}
                className="group inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white px-2 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              >
                {name}
                <button
                  type="button"
                  onClick={() => removePantryDefault(name)}
                  className="text-zinc-400 hover:text-red-600"
                  aria-label={`remove ${name} from pantry defaults`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Backup */}
      <section>
        <h2 className="mb-3 text-xl font-semibold">Backup</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Download a JSON snapshot of your dishes, pantry defaults, and meal
          plan. Import the same file to restore. Dishes upsert by id; pantry
          names are additive; meal plan is replaced.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={downloadBackup}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Download backup
          </button>
          <label className="cursor-pointer rounded-md border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950">
            {importing ? "Importing…" : "Import backup"}
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              disabled={importing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importBackup(file);
                e.target.value = "";
              }}
            />
          </label>
          {backupMsg && <span className="text-sm">{backupMsg}</span>}
        </div>
      </section>

      {/* All dishes */}
      <section>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-xl font-semibold">All dishes ({dishes.length})</h2>
          <Link
            href="/add"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            + Add
          </Link>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={bulkGenerate}
            disabled={bulkRunning}
          >
            {bulkRunning ? "Generating…" : "Generate missing images"}
          </Button>
          {bulkMsg && <span className="text-sm text-ink-3">{bulkMsg}</span>}
        </div>
        {dishes.length === 0 ? (
          <p className="text-zinc-500">No dishes yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {dishes.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1">
                  <div className="font-medium">{d.title}</div>
                  {d.subtitle && (
                    <div className="text-sm text-zinc-500">{d.subtitle}</div>
                  )}
                  {d.tags.length > 0 && (
                    <div className="mt-1 text-xs text-zinc-500">
                      {d.tags.join(" · ")}
                    </div>
                  )}
                </div>
                <Link
                  href={`/dishes/${d.id}/edit`}
                  className="text-sm text-emerald-600 hover:underline"
                >
                  edit
                </Link>
                <button
                  type="button"
                  onClick={() => copyDish(d)}
                  className="text-sm text-zinc-500 hover:underline"
                  title="Duplicate this dish as a new draft"
                >
                  copy
                </button>
                <button
                  type="button"
                  onClick={() => del(d.id)}
                  className="text-sm text-red-600 hover:underline"
                >
                  delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function messageForPwError(code: string | undefined): string {
  switch (code) {
    case "password_too_short":
      return "New password must be at least 8 characters.";
    case "wrong_current_password":
      return "Current password is wrong.";
    case "no_password_set":
      return "Your account has no password (Google sign-in only).";
    default:
      return "Password change failed.";
  }
}
