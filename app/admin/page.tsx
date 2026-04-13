"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dish, Ingredient } from "@/lib/types";
import { STANDARD_INGREDIENTS, STANDARD_UNITS } from "@/lib/vocabulary";

type IngredientDraft = {
  quantity: string;
  unit: string;
  descriptor: string;
  name: string;
  preparation: string;
};

const EMPTY_INGREDIENT: IngredientDraft = {
  quantity: "",
  unit: "",
  descriptor: "",
  name: "",
  preparation: "",
};

type Draft = {
  id: number | null;
  title: string;
  subtitle: string;
  recipe: string;
  tagsInput: string;
  baseServings: string;
  ingredients: IngredientDraft[];
};

const EMPTY_DRAFT: Draft = {
  id: null,
  title: "",
  subtitle: "",
  recipe: "",
  tagsInput: "",
  baseServings: "4",
  ingredients: [{ ...EMPTY_INGREDIENT }],
};

function dishToDraft(d: Dish): Draft {
  return {
    id: d.id,
    title: d.title,
    subtitle: d.subtitle ?? "",
    recipe: d.recipe ?? "",
    tagsInput: d.tags.join(", "),
    baseServings: String(d.baseServings),
    ingredients:
      d.ingredients.length > 0
        ? d.ingredients.map((i) => ({
            quantity: String(i.quantity),
            unit: i.unit ?? "",
            descriptor: i.descriptor ?? "",
            name: i.name,
            preparation: i.preparation ?? "",
          }))
        : [{ ...EMPTY_INGREDIENT }],
  };
}

function draftToPayload(d: Draft) {
  const ingredients: Ingredient[] = d.ingredients
    .filter((i) => i.name.trim().length > 0)
    .map((i) => ({
      quantity: Number(i.quantity) || 0,
      unit: i.unit.trim() || null,
      name: i.name.trim(),
      descriptor: i.descriptor.trim() || null,
      preparation: i.preparation.trim() || null,
    }));
  const tags = d.tagsInput
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    title: d.title.trim(),
    subtitle: d.subtitle.trim() || null,
    recipe: d.recipe.trim() || null,
    tags,
    ingredients,
    baseServings: Number(d.baseServings) || 4,
  };
}

export default function AdminPage() {
  const router = useRouter();
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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

  async function reload() {
    const [dRes, tRes, nRes] = await Promise.all([
      fetch("/api/dishes"),
      fetch("/api/tags"),
      fetch("/api/ingredient-names"),
    ]);
    setDishes((await dRes.json()) as Dish[]);
    setTagSuggestions((await tRes.json()) as string[]);
    setExistingNames((await nRes.json()) as string[]);
  }

  useEffect(() => {
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

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    router.push("/admin/login");
    router.refresh();
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
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Admin</h1>
        <button
          type="button"
          onClick={logout}
          className="text-sm text-zinc-500 hover:underline"
        >
          Log out
        </button>
      </div>

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

          <div>
            <span className="text-sm font-medium">Ingredients</span>
            <p className="mb-2 text-xs text-zinc-500">
              <span className="font-medium">name</span> is the bare purchasable
              thing (&ldquo;green chili&rdquo;, &ldquo;tomato&rdquo;).{" "}
              <span className="font-medium">descriptor</span> is
              size/quality that matters at the store (small, medium, large).{" "}
              <span className="font-medium">prep</span> is cut/cook prep
              (&ldquo;thinly sliced&rdquo;) &mdash; dropped from the shopping
              list.
            </p>
            <div className="mt-1 flex flex-col gap-3">
              {draft.ingredients.map((ing, i) => (
                <div
                  key={i}
                  className="rounded border border-zinc-200 p-2 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      step="any"
                      placeholder="qty"
                      value={ing.quantity}
                      onChange={(e) =>
                        updateIngredient(i, { quantity: e.target.value })
                      }
                      className="w-20 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <input
                      list="standard-units"
                      placeholder="unit (g, tbsp…)"
                      value={ing.unit}
                      onChange={(e) =>
                        updateIngredient(i, { unit: e.target.value })
                      }
                      className="w-28 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <input
                      placeholder="size (medium…)"
                      value={ing.descriptor}
                      onChange={(e) =>
                        updateIngredient(i, { descriptor: e.target.value })
                      }
                      className="w-32 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <input
                      list="ingredient-names"
                      placeholder="name (green chili)"
                      value={ing.name}
                      onChange={(e) =>
                        updateIngredient(i, { name: e.target.value })
                      }
                      className="min-w-40 flex-1 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <button
                      type="button"
                      onClick={() => removeIngredient(i)}
                      className="text-sm text-red-600"
                      aria-label="remove ingredient"
                    >
                      ×
                    </button>
                  </div>
                  <input
                    placeholder="prep (thinly sliced, peeled and diced…)"
                    value={ing.preparation}
                    onChange={(e) =>
                      updateIngredient(i, { preparation: e.target.value })
                    }
                    className="mt-2 w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={addIngredient}
                className="self-start text-sm text-emerald-600 hover:underline"
              >
                + add ingredient
              </button>
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
    </div>
  );
}
