"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dish, Ingredient } from "@/lib/types";
import { PANTRY_DEFAULTS, STANDARD_INGREDIENTS, STANDARD_UNITS } from "@/lib/vocabulary";
import { moveItem } from "@/lib/reorder";
import { AppHeader } from "../_components/app-header";
import { Button } from "../_components/ui";

type IngredientDraft = {
  quantity: string;
  unit: string;
  descriptor: string;
  name: string;
  preparation: string;
  pantry: boolean;
  // `fixed` is the inverse of `scalable`. Default false (i.e. scalable).
  fixed: boolean;
  optional: boolean;
  // Comma-separated alternative names in the input; parsed on save.
  alternativesInput: string;
};

const EMPTY_INGREDIENT: IngredientDraft = {
  quantity: "",
  unit: "",
  descriptor: "",
  name: "",
  preparation: "",
  pantry: false,
  fixed: false,
  optional: false,
  alternativesInput: "",
};

type Draft = {
  id: number | null;
  title: string;
  subtitle: string;
  recipe: string;
  notes: string;
  tagsInput: string;
  baseServings: string;
  imageUrl: string;
  emoji: string;
  accent: string;
  favorite: boolean;
  ingredients: IngredientDraft[];
};

const EMPTY_DRAFT: Draft = {
  id: null,
  title: "",
  subtitle: "",
  recipe: "",
  notes: "",
  tagsInput: "",
  baseServings: "4",
  imageUrl: "",
  emoji: "",
  accent: "",
  favorite: false,
  ingredients: [{ ...EMPTY_INGREDIENT }],
};

function dishToDraft(d: Dish): Draft {
  return {
    id: d.id,
    title: d.title,
    subtitle: d.subtitle ?? "",
    recipe: d.recipe ?? "",
    notes: d.notes ?? "",
    tagsInput: d.tags.join(", "),
    baseServings: String(d.baseServings),
    imageUrl: d.imageUrl ?? "",
    emoji: d.emoji ?? "",
    accent: d.accent ?? "",
    favorite: d.favorite,
    ingredients:
      d.ingredients.length > 0
        ? d.ingredients.map((i) => ({
            quantity: String(i.quantity),
            unit: i.unit ?? "",
            descriptor: i.descriptor ?? "",
            name: i.name,
            preparation: i.preparation ?? "",
            pantry: !!i.pantry,
            fixed: i.scalable === false,
            optional: !!i.optional,
            alternativesInput: (i.alternatives ?? []).join(", "),
          }))
        : [{ ...EMPTY_INGREDIENT }],
  };
}

function draftToPayload(d: Draft) {
  const ingredients: Ingredient[] = d.ingredients
    .filter((i) => i.name.trim().length > 0)
    .map((i) => {
      const alternatives = i.alternativesInput
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      return {
        quantity: Number(i.quantity) || 0,
        unit: i.unit.trim() || null,
        name: i.name.trim(),
        descriptor: i.descriptor.trim() || null,
        preparation: i.preparation.trim() || null,
        pantry: i.pantry || null,
        // fixed checkbox (UI) → scalable:false (data)
        scalable: i.fixed ? false : null,
        optional: i.optional || null,
        alternatives: alternatives.length > 0 ? alternatives : null,
      };
    });
  const tags = d.tagsInput
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    title: d.title.trim(),
    subtitle: d.subtitle.trim() || null,
    recipe: d.recipe.trim() || null,
    notes: d.notes.trim() || null,
    tags,
    ingredients,
    baseServings: Number(d.baseServings) || 4,
    imageUrl: d.imageUrl.trim() || null,
    emoji: d.emoji.trim() || null,
    accent: d.accent.trim() || null,
    favorite: d.favorite,
  };
}

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

export default function AdminPage() {
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [pantryDefaults, setPantryDefaults] = useState<string[]>([]);
  const [newPantryName, setNewPantryName] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageMsg, setImageMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [handleArmedIndex, setHandleArmedIndex] = useState<number | null>(null);

  const pantryDefaultsSet = useMemo(
    () => new Set(pantryDefaults.map((n) => n.toLowerCase())),
    [pantryDefaults],
  );

  // Standard vocabulary + names already used in the DB, deduped & sorted.
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

  async function generateImage() {
    if (!draft.id) return;
    setGeneratingImage(true);
    setImageMsg(null);
    try {
      const res = await fetch(`/api/dishes/${draft.id}/image`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        imageUrl?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (!data.imageUrl) throw new Error("response missing imageUrl");
      setDraft((d) => ({ ...d, imageUrl: data.imageUrl! }));
    } catch (err) {
      setImageMsg(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGeneratingImage(false);
    }
  }

  async function reload() {
    const [dRes, tRes, nRes, pRes] = await Promise.all([
      fetch("/api/dishes"),
      fetch("/api/tags"),
      fetch("/api/ingredient-names"),
      fetch("/api/pantry-defaults"),
    ]);
    setDishes((await dRes.json()) as Dish[]);
    setTagSuggestions((await tRes.json()) as string[]);
    setExistingNames((await nRes.json()) as string[]);
    setPantryDefaults((await pRes.json()) as string[]);
  }

  async function addPantryDefault(name: string) {
    const normalized = name.toLowerCase().trim();
    if (!normalized) return;
    if (pantryDefaultsSet.has(normalized)) return;
    const res = await fetch("/api/pantry-defaults", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: normalized }),
    });
    if (res.ok) {
      setPantryDefaults((prev) =>
        [...prev, normalized].sort((a, b) => a.localeCompare(b)),
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

  // Ingredient names in the current draft that are pantry-flagged but not
  // yet in the curated pantry_names set. Used by the bulk "pin all" button.
  const pinnableFromDraft = useMemo(() => {
    const names = new Set<string>();
    for (const ing of draft.ingredients) {
      const name = ing.name.trim().toLowerCase();
      if (!name) continue;
      if (!ing.pantry) continue;
      if (pantryDefaultsSet.has(name)) continue;
      names.add(name);
    }
    return [...names];
  }, [draft.ingredients, pantryDefaultsSet]);

  async function pinAllFlagged() {
    const added: string[] = [];
    for (const name of pinnableFromDraft) {
      const res = await fetch("/api/pantry-defaults", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) added.push(name);
    }
    if (added.length > 0) {
      setPantryDefaults((prev) =>
        [...new Set([...prev, ...added])].sort((a, b) => a.localeCompare(b)),
      );
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload().catch(() => {});
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    const payload = draftToPayload(draft);
    if (!payload.title) {
      setMsg("Title is required");
      setSaving(false);
      return;
    }
    const url =
      draft.id != null ? `/api/dishes/${draft.id}` : "/api/dishes";
    const method = draft.id != null ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(data.error ?? `HTTP ${res.status}`);
      return;
    }
    setMsg(draft.id != null ? "Updated." : "Created.");
    setDraft(EMPTY_DRAFT);
    reload();
  }

  async function del(id: number) {
    if (!confirm("Delete this dish?")) return;
    const res = await fetch(`/api/dishes/${id}`, { method: "DELETE" });
    if (res.ok) reload();
  }

  function updateIngredient(i: number, patch: Partial<IngredientDraft>) {
    setDraft((d) => {
      const next = [...d.ingredients];
      next[i] = { ...next[i], ...patch };
      return { ...d, ingredients: next };
    });
  }

  function addIngredient() {
    setDraft((d) => ({
      ...d,
      ingredients: [...d.ingredients, { ...EMPTY_INGREDIENT }],
    }));
  }

  function removeIngredient(i: number) {
    setDraft((d) => ({
      ...d,
      ingredients: d.ingredients.filter((_, j) => j !== i),
    }));
  }

  function reorderIngredient(from: number, to: number) {
    setDraft((d) => ({
      ...d,
      ingredients: moveItem(d.ingredients, from, to),
    }));
  }

  function resetDragState() {
    setDragIndex(null);
    setDropTargetIndex(null);
    setHandleArmedIndex(null);
  }

  function addTag(tag: string) {
    const current = draft.tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (current.includes(tag)) return;
    setDraft((d) => ({
      ...d,
      tagsInput: [...current, tag].join(", "),
    }));
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <AppHeader title="Admin" right={<LogoutButton />} />
      <div className="flex-1 overflow-auto pb-20">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6">

      <section>
        <h2 className="mb-3 text-xl font-semibold">
          {draft.id != null ? "Edit dish" : "New dish"}
        </h2>
        <form
          onSubmit={save}
          className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Title *</span>
            <input
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Subtitle</span>
            <input
              value={draft.subtitle}
              onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
              className="rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">
              Tags (comma-separated)
            </span>
            <input
              value={draft.tagsInput}
              onChange={(e) =>
                setDraft({ ...draft, tagsInput: e.target.value })
              }
              placeholder="vegetarian, bbq, Finn likes this"
              className="rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            />
            {tagSuggestions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {tagSuggestions.map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => addTag(t)}
                    className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    + {t}
                  </button>
                ))}
              </div>
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Base servings</span>
            <input
              type="number"
              min={1}
              value={draft.baseServings}
              onChange={(e) =>
                setDraft({ ...draft, baseServings: e.target.value })
              }
              className="w-24 rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Image URL</span>
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="https://…"
                value={draft.imageUrl}
                onChange={(e) =>
                  setDraft({ ...draft, imageUrl: e.target.value })
                }
                className="flex-1 rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
              />
              <span
                title={
                  draft.id
                    ? "Generate AI photo for this dish"
                    : "Save the dish first, then generate"
                }
              >
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={!draft.id || generatingImage}
                  onClick={generateImage}
                >
                  {generatingImage ? "Generating…" : "Generate"}
                </Button>
              </span>
            </div>
            {imageMsg && (
              <span className="text-sm text-warn">{imageMsg}</span>
            )}
            {draft.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={draft.imageUrl}
                alt="preview"
                className="mt-2 h-32 w-auto rounded border border-zinc-200 object-cover dark:border-zinc-800"
              />
            )}
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Emoji
            <input
              type="text"
              value={draft.emoji}
              onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
              maxLength={8}
              placeholder="🍲"
              className="w-24 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Accent
            <input
              type="text"
              value={draft.accent}
              onChange={(e) => setDraft({ ...draft, accent: e.target.value })}
              maxLength={60}
              placeholder="oklch(70% 0.14 40)"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={draft.favorite}
              onChange={(e) =>
                setDraft({ ...draft, favorite: e.target.checked })
              }
            />
            ★ favourite
          </label>

          <div>
            <span className="text-sm font-medium">Ingredients</span>
            <p className="mb-2 text-xs text-zinc-500">
              <span className="font-medium">name</span> is the bare purchasable
              thing (&ldquo;green chili&rdquo;, &ldquo;tomato&rdquo;).{" "}
              <span className="font-medium">descriptor</span> is
              size/quality that matters at the store (small, medium, large).{" "}
              <span className="font-medium">prep</span> is cut/cook prep
              (&ldquo;thinly sliced&rdquo;) &mdash; dropped from the shopping
              list. Tick <span className="font-medium">pantry</span> for
              things you always have in stock (water, salt, pepper,
              olive oil) &mdash; they&rsquo;re shown on the dish but never
              added to the shopping list.
            </p>
            <div className="mt-1 flex flex-col gap-3">
              {draft.ingredients.map((ing, i) => {
                const isDragSource = dragIndex === i;
                const isDropTarget =
                  dropTargetIndex === i &&
                  dragIndex !== null &&
                  dragIndex !== i;
                return (
                <div
                  key={i}
                  draggable={handleArmedIndex === i}
                  onDragStart={(e) => {
                    setDragIndex(i);
                    e.dataTransfer.effectAllowed = "move";
                    // Payload is unused but some browsers refuse to
                    // start a drag without any data.
                    e.dataTransfer.setData("text/plain", String(i));
                  }}
                  onDragOver={(e) => {
                    if (dragIndex === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dropTargetIndex !== i) setDropTargetIndex(i);
                  }}
                  onDragLeave={() => {
                    if (dropTargetIndex === i) setDropTargetIndex(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null && dragIndex !== i) {
                      reorderIngredient(dragIndex, i);
                    }
                    resetDragState();
                  }}
                  onDragEnd={resetDragState}
                  className={`rounded border p-2 transition-colors ${
                    isDropTarget
                      ? "border-emerald-500 ring-2 ring-emerald-500/30"
                      : "border-zinc-200 dark:border-zinc-800"
                  } ${isDragSource ? "opacity-60" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      aria-label="drag to reorder ingredient"
                      title="Drag to reorder"
                      onPointerDown={() => setHandleArmedIndex(i)}
                      onPointerUp={() => setHandleArmedIndex(null)}
                      onPointerCancel={() => setHandleArmedIndex(null)}
                      onPointerLeave={() => {
                        if (handleArmedIndex === i && dragIndex === null) {
                          setHandleArmedIndex(null);
                        }
                      }}
                      className="flex h-9 w-6 shrink-0 cursor-grab items-center justify-center text-zinc-400 select-none hover:text-zinc-600 active:cursor-grabbing dark:hover:text-zinc-200"
                    >
                      ⋮⋮
                    </button>
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      placeholder="qty"
                      value={ing.quantity}
                      onChange={(e) =>
                        updateIngredient(i, { quantity: e.target.value })
                      }
                      className="w-16 rounded border border-zinc-300 px-2 py-1.5 text-base dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <input
                      list="standard-units"
                      placeholder="unit"
                      value={ing.unit}
                      onChange={(e) =>
                        updateIngredient(i, { unit: e.target.value })
                      }
                      className="w-20 rounded border border-zinc-300 px-2 py-1.5 text-base dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <input
                      placeholder="size"
                      value={ing.descriptor}
                      onChange={(e) =>
                        updateIngredient(i, { descriptor: e.target.value })
                      }
                      className="w-20 rounded border border-zinc-300 px-2 py-1.5 text-base dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <input
                      list="ingredient-names"
                      placeholder="name"
                      value={ing.name}
                      onChange={(e) => {
                        const name = e.target.value;
                        const patch: Partial<IngredientDraft> = { name };
                        if (PANTRY_DEFAULTS.has(name.toLowerCase().trim())) {
                          patch.pantry = true;
                        }
                        updateIngredient(i, patch);
                      }}
                      className="min-w-[10rem] flex-1 rounded border border-zinc-300 px-2 py-1.5 text-base dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <button
                      type="button"
                      onClick={() => reorderIngredient(i, i - 1)}
                      disabled={i === 0}
                      className="flex h-9 w-8 shrink-0 items-center justify-center rounded border border-zinc-200 text-sm disabled:opacity-30 dark:border-zinc-800"
                      aria-label="move ingredient up"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => reorderIngredient(i, i + 1)}
                      disabled={i === draft.ingredients.length - 1}
                      className="flex h-9 w-8 shrink-0 items-center justify-center rounded border border-zinc-200 text-sm disabled:opacity-30 dark:border-zinc-800"
                      aria-label="move ingredient down"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeIngredient(i)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-zinc-200 text-lg text-red-600 hover:bg-red-50 dark:border-zinc-800 dark:hover:bg-red-950"
                      aria-label="remove ingredient"
                    >
                      ×
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <input
                      placeholder="prep (thinly sliced…)"
                      value={ing.preparation}
                      onChange={(e) =>
                        updateIngredient(i, { preparation: e.target.value })
                      }
                      className="min-w-[10rem] flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <label className="flex shrink-0 items-center gap-1.5 py-1 text-xs text-zinc-500 select-none">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={ing.pantry}
                        onChange={(e) =>
                          updateIngredient(i, { pantry: e.target.checked })
                        }
                      />
                      pantry
                    </label>
                    {ing.pantry &&
                      ing.name.trim() &&
                      !pantryDefaultsSet.has(
                        ing.name.trim().toLowerCase(),
                      ) && (
                        <button
                          type="button"
                          onClick={() => addPantryDefault(ing.name)}
                          className="shrink-0 text-xs text-emerald-600 hover:underline"
                          title={`Add "${ing.name.trim()}" to pantry defaults so it auto-flags next time`}
                        >
                          pin to defaults
                        </button>
                      )}
                    <label
                      className="flex shrink-0 items-center gap-1.5 py-1 text-xs text-zinc-500 select-none"
                      title="Quantity stays the same regardless of servings (e.g. 1 bay leaf)"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={ing.fixed}
                        onChange={(e) =>
                          updateIngredient(i, { fixed: e.target.checked })
                        }
                      />
                      fixed
                    </label>
                    <label
                      className="flex shrink-0 items-center gap-1.5 py-1 text-xs text-zinc-500 select-none"
                      title="Optional ingredient — excluded from the shopping list unless the user opts in"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={ing.optional}
                        onChange={(e) =>
                          updateIngredient(i, { optional: e.target.checked })
                        }
                      />
                      optional
                    </label>
                  </div>
                  <input
                    placeholder="alternatives (comma-separated, e.g. 'olive oil, ghee')"
                    value={ing.alternativesInput}
                    onChange={(e) =>
                      updateIngredient(i, {
                        alternativesInput: e.target.value,
                      })
                    }
                    className="mt-2 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
                );
              })}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={addIngredient}
                  className="text-sm text-emerald-600 hover:underline"
                >
                  + add ingredient
                </button>
                {pinnableFromDraft.length > 0 && (
                  <button
                    type="button"
                    onClick={pinAllFlagged}
                    className="rounded-md border border-emerald-600 px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                    title={`Add to pantry defaults: ${pinnableFromDraft.join(", ")}`}
                  >
                    pin {pinnableFromDraft.length} pantry item
                    {pinnableFromDraft.length === 1 ? "" : "s"} to defaults
                  </button>
                )}
              </div>
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Recipe (markdown)</span>
            <textarea
              rows={8}
              value={draft.recipe}
              onChange={(e) => setDraft({ ...draft, recipe: e.target.value })}
              className="rounded border border-zinc-300 px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Notes</span>
            <span className="text-xs text-zinc-500">
              Persistent scratch pad. Shown as a yellow sticky note above
              the ingredients on the dish page. Use for things like
              &ldquo;Finn won&rsquo;t eat this if there are mushrooms&rdquo;
              or &ldquo;usually 1.5× the chili&rdquo;.
            </span>
            <textarea
              rows={3}
              maxLength={5000}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-70"
            >
              {saving ? "Saving…" : draft.id != null ? "Update" : "Create"}
            </button>
            {draft.id != null && (
              <button
                type="button"
                onClick={() => setDraft(EMPTY_DRAFT)}
                className="text-sm text-zinc-500 hover:underline"
              >
                Cancel edit
              </button>
            )}
            {msg && <span className="text-sm">{msg}</span>}
          </div>

          <datalist id="standard-units">
            {STANDARD_UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <datalist id="ingredient-names">
            {ingredientNameOptions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">All dishes ({dishes.length})</h2>
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
                  onClick={() => {
                    setDraft(dishToDraft(d));
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="text-sm text-emerald-600 hover:underline"
                >
                  edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft({
                      ...dishToDraft(d),
                      id: null,
                      title: `${d.title} (copy)`,
                    });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
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
