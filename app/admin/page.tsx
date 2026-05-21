"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dish, DishInput } from "@/lib/types";
import { STANDARD_INGREDIENTS } from "@/lib/vocabulary";
import { AppHeader } from "../_components/app-header";
import DishForm from "../_components/dish-form";
import { Button } from "../_components/ui";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    router.push("/admin/login");
    router.refresh();
  }
  return (
    <Button variant="ghost" size="sm" onClick={logout}>
      Log out
    </Button>
  );
}

/** Convert a full Dish to a DishInput (strip server-only fields like id). */
function dishToInput(d: Dish): DishInput {
  return {
    title: d.title,
    subtitle: d.subtitle ?? undefined,
    recipe: d.recipe ?? undefined,
    notes: d.notes ?? undefined,
    tags: d.tags,
    baseServings: d.baseServings,
    imageUrl: d.imageUrl ?? undefined,
    imageDescription: d.imageDescription ?? undefined,
    emoji: d.emoji ?? undefined,
    accent: d.accent ?? undefined,
    favorite: d.favorite,
    ingredients: d.ingredients,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminPage() {
  const [dishes, setDishes] = useState<Dish[]>([]);

  // Form state: editingDish drives edit mode; prefillDish drives copy/create mode.
  // formKey forces DishForm to remount whenever we switch dishes.
  const [editingDish, setEditingDish] = useState<Dish | undefined>(undefined);
  const [prefillDish, setPrefillDish] = useState<DishInput | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);

  // Pantry section state (independent of DishForm's own copy).
  const [pantryDefaults, setPantryDefaults] = useState<string[]>([]);
  const [newPantryName, setNewPantryName] = useState("");
  const [existingNames, setExistingNames] = useState<string[]>([]);

  // Bulk image gen state.
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  // Backup section state.
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Ingredient name options for the pantry section datalist.
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
    const [dRes, nRes, pRes] = await Promise.all([
      fetch("/api/dishes"),
      fetch("/api/ingredient-names"),
      fetch("/api/pantry-defaults"),
    ]);
    if (dRes.ok) setDishes((await dRes.json()) as Dish[]);
    if (nRes.ok) setExistingNames((await nRes.json()) as string[]);
    if (pRes.ok) setPantryDefaults((await pRes.json()) as string[]);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload().catch(() => {});
  }, []);

  function startEdit(dish: Dish) {
    setEditingDish(dish);
    setPrefillDish(undefined);
    setFormKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startCopy(dish: Dish) {
    setEditingDish(undefined);
    setPrefillDish({ ...dishToInput(dish), title: `${dish.title} (copy)` });
    setFormKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setEditingDish(undefined);
    setPrefillDish(undefined);
    setFormKey((k) => k + 1);
  }

  async function del(id: number) {
    if (!confirm("Delete this dish?")) return;
    const res = await fetch(`/api/dishes/${id}`, { method: "DELETE" });
    if (res.ok) reload();
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
      if (data.failed && data.failed.length > 0) {
        // eslint-disable-next-line no-console
        console.warn("Bulk image-gen failures:", data.failed);
      }
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
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setBackupMsg("Not valid JSON");
        return;
      }
      const envelope = parsed as {
        dishes?: unknown[];
        pantryNames?: unknown[];
        mealPlan?: { entries?: unknown[] };
      };
      const dishCount = Array.isArray(envelope.dishes)
        ? envelope.dishes.length
        : 0;
      const pantryCount = Array.isArray(envelope.pantryNames)
        ? envelope.pantryNames.length
        : 0;
      const mealCount = Array.isArray(envelope.mealPlan?.entries)
        ? envelope.mealPlan.entries.length
        : 0;
      const ok = confirm(
        `Import ${dishCount} dishes, ${pantryCount} pantry names, ` +
          `${mealCount} meal-plan entries?\n\n` +
          "Dishes are upserted by id (existing dishes with matching ids " +
          "are overwritten). Pantry names are additive. Meal plan is " +
          "replaced.",
      );
      if (!ok) return;
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        counts?: {
          dishes: number;
          pantryNames: number;
          mealPlanEntries: number;
        };
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <AppHeader title="Admin" right={<LogoutButton />} />
      <div className="flex-1 overflow-auto pb-20">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6">

          <section>
            <h2 className="mb-3 text-xl font-semibold">
              {editingDish ? "Edit dish" : "New dish"}
            </h2>
            <DishForm
              key={formKey}
              initial={editingDish}
              prefillDraft={prefillDish}
              onSaved={() => {
                resetForm();
                reload();
              }}
              onCanceled={resetForm}
            />
          </section>

          <section>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-xl font-semibold">All dishes ({dishes.length})</h2>
              <a
                href="/admin/ingest"
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              >
                Ingest →
              </a>
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
                    <button
                      type="button"
                      onClick={() => startEdit(d)}
                      className="text-sm text-emerald-600 hover:underline"
                    >
                      edit
                    </button>
                    <button
                      type="button"
                      onClick={() => startCopy(d)}
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

          <section>
            <h2 className="mb-3 text-xl font-semibold">
              Pantry defaults ({pantryDefaults.length})
            </h2>
            <p className="mb-3 text-xs text-zinc-500">
              Ingredient names in this list auto-flag <code>pantry: true</code>{" "}
              when used in any dish. They&rsquo;re excluded from the shopping list
              and Todoist push. Match is case-insensitive, exact name (no
              fuzzy).
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

          <section>
            <h2 className="mb-3 text-xl font-semibold">Backup</h2>
            <p className="mb-3 text-xs text-zinc-500">
              Download a JSON snapshot of all dishes, pantry defaults, and meal
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

        </div>
      </div>
    </div>
  );
}
