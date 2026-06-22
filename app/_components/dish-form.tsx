"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Dish, DishInput, Ingredient } from "@/lib/types";
import { PANTRY_DEFAULTS, STANDARD_INGREDIENTS, STANDARD_UNITS } from "@/lib/vocabulary";
import { moveItem } from "@/lib/reorder";
import { Button, DishArt } from "./ui";
import { Icon } from "./icon";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type IngredientDraft = {
  // Stable id carried through edits so inline `[label](#id)` references in the
  // method keep resolving across reorders. Empty for a freshly-added row; the
  // server mints one on save (assignIngredientIds).
  id: string;
  quantity: string;
  unit: string;
  descriptor: string;
  name: string;
  preparation: string;
  section: string;
  pantry: boolean;
  // `fixed` is the inverse of `scalable`. Default false (i.e. scalable).
  fixed: boolean;
  optional: boolean;
  // Comma-separated alternative names in the input; parsed on save.
  alternativesInput: string;
};

const EMPTY_INGREDIENT: IngredientDraft = {
  id: "",
  quantity: "",
  unit: "",
  descriptor: "",
  name: "",
  preparation: "",
  section: "",
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
  imageDescription: string;
  emoji: string;
  accent: string;
  favorite: boolean;
  public: boolean;
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
  imageDescription: "",
  emoji: "",
  accent: "",
  favorite: false,
  public: true,
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
    imageDescription: d.imageDescription ?? "",
    emoji: d.emoji ?? "",
    accent: d.accent ?? "",
    favorite: d.favorite,
    public: d.public,
    ingredients:
      d.ingredients.length > 0
        ? d.ingredients.map((i) => ({
            id: i.id ?? "",
            quantity: String(i.quantity),
            unit: i.unit ?? "",
            descriptor: i.descriptor ?? "",
            name: i.name,
            preparation: i.preparation ?? "",
            section: i.section ?? "",
            pantry: !!i.pantry,
            fixed: i.scalable === false,
            optional: !!i.optional,
            alternativesInput: (i.alternatives ?? []).join(", "),
          }))
        : [{ ...EMPTY_INGREDIENT }],
  };
}

function dishInputToDraft(d: DishInput): Draft {
  return {
    id: null,
    title: d.title,
    subtitle: d.subtitle ?? "",
    recipe: d.recipe ?? "",
    notes: d.notes ?? "",
    tagsInput: (d.tags ?? []).join(", "),
    baseServings: String(d.baseServings ?? 4),
    imageUrl: d.imageUrl ?? "",
    imageDescription: d.imageDescription ?? "",
    emoji: d.emoji ?? "",
    accent: d.accent ?? "",
    favorite: d.favorite ?? false,
    public: d.public ?? true,
    ingredients:
      (d.ingredients ?? []).length > 0
        ? d.ingredients!.map((i) => ({
            id: i.id ?? "",
            quantity: String(i.quantity),
            unit: i.unit ?? "",
            descriptor: i.descriptor ?? "",
            name: i.name,
            preparation: i.preparation ?? "",
            section: i.section ?? "",
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
        // Preserve the stable id on existing rows; a blank (new) row is left
        // id-less so the server mints one. Inline method references resolve by
        // this id, so it must survive reorders untouched.
        id: i.id.trim() || undefined,
        quantity: Number(i.quantity) || 0,
        unit: i.unit.trim() || null,
        name: i.name.trim(),
        descriptor: i.descriptor.trim() || null,
        preparation: i.preparation.trim() || null,
        section: i.section.trim() || null,
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
    imageDescription: d.imageDescription.trim() || null,
    emoji: d.emoji.trim() || null,
    accent: d.accent.trim() || null,
    favorite: d.favorite,
    public: d.public,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type DishFormProps = {
  /** undefined = create mode; defined = edit mode (dish already exists) */
  initial?: Dish;
  /** Pre-fill draft (used by /add when the ingest flow returns a parsed dish) */
  prefillDraft?: DishInput;
  /** Called with the saved dish after a successful POST or PATCH */
  onSaved?: (dish: Dish) => void;
  /** Called when the user clicks "Cancel edit" */
  onCanceled?: () => void;
};

export default function DishForm({
  initial,
  prefillDraft,
  onSaved,
  onCanceled,
}: DishFormProps) {
  const [draft, setDraft] = useState<Draft>(() => {
    if (initial) return dishToDraft(initial);
    if (prefillDraft) return dishInputToDraft(prefillDraft);
    return EMPTY_DRAFT;
  });

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageMsg, setImageMsg] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [handleArmedIndex, setHandleArmedIndex] = useState<number | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [pantryDefaults, setPantryDefaults] = useState<string[]>([]);

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

  // Fetch suggestions on mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all([
      fetch("/api/tags").then((r) => r.json() as Promise<string[]>),
      fetch("/api/ingredient-names").then((r) => r.json() as Promise<string[]>),
      fetch("/api/pantry-defaults").then((r) => r.json() as Promise<string[]>),
    ])
      .then(([tags, names, pantry]) => {
        setTagSuggestions(tags);
        setExistingNames(names);
        setPantryDefaults(pantry);
      })
      .catch(() => {});
  }, []);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

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
    const dish = (await res.json()) as Dish;
    setMsg(draft.id != null ? "Updated." : "Created.");
    setDraft(EMPTY_DRAFT);
    onSaved?.(dish);
  }

  async function generateImage() {
    if (!draft.id) return;
    setGeneratingImage(true);
    setImageMsg(null);
    try {
      const res = await fetch(`/api/dishes/${draft.id}/image`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
      };
      if (!res.ok || !data.jobId) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const jobId = data.jobId;
      const deadline = Date.now() + 180_000; // poll up to 3 min
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetch(
          `/api/dishes/${draft.id}/image/jobs/${jobId}`,
        );
        const pd = (await poll.json().catch(() => ({}))) as {
          status?: string;
          imageUrl?: string | null;
          error?: string | null;
        };
        if (!poll.ok) continue; // tolerate a transient poll blip; deadline backstops
        if (pd.status === "done" && pd.imageUrl) {
          setDraft((d) => ({ ...d, imageUrl: pd.imageUrl! }));
          return;
        }
        if (pd.status === "failed") {
          throw new Error(pd.error ?? "Generation failed");
        }
      }
      setImageMsg("Still generating — refresh in a moment.");
    } catch (err) {
      setImageMsg(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGeneratingImage(false);
    }
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

  // ------------------------------------------------------------------
  // Derived (presentational)
  // ------------------------------------------------------------------

  const currentTags = draft.tagsInput
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const filledIngredientCount = draft.ingredients.filter((i) => i.name.trim()).length;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <form onSubmit={save} className="flex flex-col gap-5 pb-2">
      {/* live preview */}
      <div className="flex items-center gap-[14px] rounded-[var(--radius-lg)] border border-line bg-surface p-[13px] shadow-[var(--shadow-card)]">
        <DishArt
          dish={{ emoji: draft.emoji || null, accent: draft.accent || null, imageUrl: draft.imageUrl || null }}
          size={56}
          corner="var(--radius-md)"
          emojiSize={28}
        />
        <div className="min-w-0 flex-1">
          <div
            className={[
              "truncate text-[17px] font-semibold leading-[1.15]",
              draft.title ? "text-text" : "text-text-faint",
            ].join(" ")}
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {draft.title || "Untitled recipe"}
          </div>
          <div className="mt-[3px] text-[12.5px] text-text-faint">
            {draft.baseServings || "0"} servings
            {currentTags.length ? ` · ${currentTags.length} tag${currentTags.length > 1 ? "s" : ""}` : ""}
            {filledIngredientCount ? ` · ${filledIngredientCount} ingredient${filledIngredientCount > 1 ? "s" : ""}` : ""}
          </div>
        </div>
      </div>

      {/* ── Basics ── */}
      <Section title="Basics">
        <Field label="Title" required>
          <input
            required
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Green chili chicken curry"
            className={inputCls}
          />
        </Field>

        <Field label="Subtitle">
          <input
            value={draft.subtitle}
            onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
            placeholder="Thai-style, weeknight-fast"
            className={inputCls}
          />
        </Field>

        <Field label="Base servings" hint="servings the quantities are written for">
          <input
            type="number"
            min={1}
            value={draft.baseServings}
            onChange={(e) => setDraft({ ...draft, baseServings: e.target.value })}
            className={`${inputCls} tnum w-28`}
          />
        </Field>

        <Field label="Tags" hint="comma-separated">
          <input
            value={draft.tagsInput}
            onChange={(e) => setDraft({ ...draft, tagsInput: e.target.value })}
            placeholder="vegetarian, bbq, Finn likes this"
            className={inputCls}
          />
          {tagSuggestions.length > 0 && (
            <div className="mt-[10px] flex flex-wrap gap-[6px]">
              {tagSuggestions
                .filter((t) => !currentTags.includes(t))
                .map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => addTag(t)}
                    className="inline-flex items-center rounded-pill border border-line bg-transparent px-[10px] py-[4px] text-[11.5px] font-medium text-text-dim transition-colors hover:border-line-2 hover:text-text"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    + {t}
                  </button>
                ))}
            </div>
          )}
        </Field>

        {/* favourite + public toggle cards */}
        <div className="mt-[18px] flex gap-[10px]">
          <ToggleCard
            on={draft.favorite}
            onClick={() => setDraft({ ...draft, favorite: !draft.favorite })}
            icon="heart"
            iconFillWhenOn
            label="Favourite"
            sub={draft.favorite ? "surfaced more" : "off"}
          />
          <ToggleCard
            on={draft.public}
            onClick={() => setDraft({ ...draft, public: !draft.public })}
            icon="link"
            label="Public"
            sub={draft.public ? "shareable by link" : "only you"}
          />
        </div>
      </Section>

      {/* ── Photo ── */}
      <Section title="Photo">
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-[14px] shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-[13px]">
            <div className="relative shrink-0">
              <DishArt
                dish={{ emoji: draft.emoji || null, accent: draft.accent || null, imageUrl: draft.imageUrl || null }}
                size={52}
                corner="var(--radius-md)"
                emojiSize={26}
              />
              {generatingImage && (
                <div
                  className="absolute inset-0 grid place-items-center rounded-[var(--radius-md)]"
                  style={{ background: "rgba(15,11,8,0.6)" }}
                >
                  <span className="spin inline-block h-[18px] w-[18px] rounded-full border-[2.5px] border-white/30 border-t-white" />
                </div>
              )}
            </div>
            <p className="min-w-0 flex-1 text-[12.5px] leading-[1.45] text-text-dim">
              {!draft.id
                ? "Save the dish first, then you can generate a photo."
                : generatingImage
                  ? "Generating a new photo from your recipe…"
                  : draft.imageUrl
                    ? "Looks good — regenerate for a different take, paste a URL below, or keep it."
                    : "Generate a photo with AI from the title and ingredients, or paste a URL below."}
            </p>
            <span
              title={
                draft.id
                  ? "Generate AI photo for this dish"
                  : "Save the dish first, then generate"
              }
            >
              <button
                type="button"
                disabled={!draft.id || generatingImage}
                onClick={generateImage}
                className="inline-flex shrink-0 items-center justify-center gap-[6px] rounded-pill border border-line bg-surface-2 px-[13px] py-[8px] text-[12.5px] font-semibold text-text transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ minWidth: 104, fontFamily: "var(--font-sans)" }}
              >
                {generatingImage ? (
                  <>
                    <span className="spin inline-block h-[13px] w-[13px] rounded-full border-2 border-accent-line border-t-accent-2" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Icon name="sparkle" size={13} />
                    {draft.imageUrl ? "Regenerate" : "Generate"}
                  </>
                )}
              </button>
            </span>
          </div>

          {/* image URL input */}
          <div className="mt-[12px]">
            <FieldLabel>Image URL</FieldLabel>
            <input
              type="url"
              placeholder="https://…"
              value={draft.imageUrl}
              onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
              className={`${inputCls} mt-[7px]`}
            />
          </div>

          {imageMsg && (
            <div className="mt-[8px] flex items-center gap-[6px] text-[12.5px] text-rose">
              <Icon name="bell" size={13} />
              {imageMsg}
            </div>
          )}

          {/* image description (gen prompt) */}
          <div className="mt-[12px]">
            <FieldLabel hint="used as the image-gen prompt; not shown publicly">
              Image description
            </FieldLabel>
            <textarea
              value={draft.imageDescription}
              onChange={(e) => setDraft({ ...draft, imageDescription: e.target.value })}
              rows={3}
              placeholder="e.g. a square of golden-brown spiced mince topped with a glossy yellow egg custard, two bay leaves on top"
              className={`${textareaCls} mt-[7px]`}
            />
          </div>
        </div>

        {/* appearance: emoji + accent */}
        <div className="mt-[14px] grid grid-cols-2 gap-[10px]">
          <div>
            <FieldLabel hint="placeholder glyph">Emoji</FieldLabel>
            <input
              type="text"
              value={draft.emoji}
              onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
              maxLength={8}
              placeholder="🍲"
              className={`${inputCls} mt-[7px]`}
            />
          </div>
          <div>
            <FieldLabel hint="placeholder colour">Accent</FieldLabel>
            <input
              type="text"
              value={draft.accent}
              onChange={(e) => setDraft({ ...draft, accent: e.target.value })}
              maxLength={60}
              placeholder="oklch(70% 0.14 40)"
              className={`${inputCls} mt-[7px]`}
            />
          </div>
        </div>
      </Section>

      {/* ── Ingredients ── */}
      <Section
        title="Ingredients"
        count={draft.ingredients.length}
        note={
          <>
            <span className="font-semibold text-text-dim">name</span> is the bare purchasable
            thing (&ldquo;green chili&rdquo;, &ldquo;tomato&rdquo;).{" "}
            <span className="font-semibold text-text-dim">size</span> is the size/quality that
            matters at the store (small, medium, large).{" "}
            <span className="font-semibold text-text-dim">prep</span> is cut/cook prep
            (&ldquo;thinly sliced&rdquo;) &mdash; dropped from the shopping list. Tick{" "}
            <span className="font-semibold text-text-dim">pantry</span> for things you always
            have in stock (water, salt, pepper, olive oil) &mdash; shown on the dish but never
            added to the shopping list.
          </>
        }
      >
        <div className="flex flex-col gap-[10px]">
          {draft.ingredients.map((ing, i) => {
            const isDragSource = dragIndex === i;
            const isDropTarget =
              dropTargetIndex === i && dragIndex !== null && dragIndex !== i;
            const showPin =
              ing.pantry &&
              ing.name.trim() &&
              !pantryDefaultsSet.has(ing.name.trim().toLowerCase());
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
                className={[
                  "rounded-[var(--radius-md)] border bg-surface p-[11px_12px] shadow-[var(--shadow-card)] transition-colors",
                  isDropTarget
                    ? "border-accent ring-2 ring-accent-line"
                    : "border-line",
                  isDragSource ? "opacity-60" : "",
                ].join(" ")}
              >
                {/* row 1: handle · qty · unit · name · remove */}
                <div className="flex items-center gap-[7px]">
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
                    className="grid h-9 w-[18px] shrink-0 cursor-grab place-items-center text-text-faint transition-colors select-none hover:text-text-dim active:cursor-grabbing"
                  >
                    <span className="text-[15px] leading-none tracking-[-2px]">⋮⋮</span>
                  </button>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    placeholder="600"
                    value={ing.quantity}
                    onChange={(e) => updateIngredient(i, { quantity: e.target.value })}
                    className={`${inputSmCls} tnum w-[52px] text-center`}
                  />
                  <input
                    list="dish-form-standard-units"
                    placeholder="g"
                    value={ing.unit}
                    onChange={(e) => updateIngredient(i, { unit: e.target.value })}
                    className={`${inputSmCls} w-[58px] text-center`}
                  />
                  <input
                    list="dish-form-ingredient-names"
                    placeholder="ingredient"
                    value={ing.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      const patch: Partial<IngredientDraft> = { name };
                      if (PANTRY_DEFAULTS.has(name.toLowerCase().trim())) {
                        patch.pantry = true;
                      }
                      updateIngredient(i, patch);
                    }}
                    className={`${inputSmCls} min-w-0 flex-1 font-semibold`}
                  />
                  <button
                    type="button"
                    onClick={() => removeIngredient(i)}
                    className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[var(--radius-sm)] text-text-faint transition-colors hover:bg-rose-tint hover:text-rose"
                    aria-label="remove ingredient"
                    title="Remove"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>

                {/* row 2: descriptor · prep · section */}
                <div className="mt-[8px] flex flex-wrap gap-[7px]">
                  <input
                    placeholder="size / quality (e.g. large)"
                    value={ing.descriptor}
                    onChange={(e) => updateIngredient(i, { descriptor: e.target.value })}
                    className={`${inputSmCls} min-w-[8rem] flex-1 text-text-dim`}
                  />
                  <input
                    placeholder="prep (e.g. thinly sliced)"
                    value={ing.preparation}
                    onChange={(e) => updateIngredient(i, { preparation: e.target.value })}
                    className={`${inputSmCls} min-w-[8rem] flex-1 text-text-dim`}
                  />
                  <input
                    placeholder="section (Dough…)"
                    value={ing.section}
                    onChange={(e) => updateIngredient(i, { section: e.target.value })}
                    className={`${inputSmCls} w-[8rem] text-text-dim`}
                  />
                </div>

                {/* row 3: flag chips + pin + reorder buttons */}
                <div className="mt-[9px] flex flex-wrap items-center gap-[7px]">
                  <FlagChip
                    on={ing.pantry}
                    onClick={() => updateIngredient(i, { pantry: !ing.pantry })}
                  >
                    pantry
                  </FlagChip>
                  <FlagChip
                    on={ing.fixed}
                    onClick={() => updateIngredient(i, { fixed: !ing.fixed })}
                    title="Quantity stays the same regardless of servings (e.g. 1 bay leaf)"
                  >
                    fixed
                  </FlagChip>
                  <FlagChip
                    on={ing.optional}
                    onClick={() => updateIngredient(i, { optional: !ing.optional })}
                    title="Optional ingredient — excluded from the shopping list unless the user opts in"
                  >
                    optional
                  </FlagChip>
                  {showPin && (
                    <button
                      type="button"
                      onClick={() => addPantryDefault(ing.name)}
                      className="inline-flex items-center gap-[4px] text-[11px] font-semibold text-sage hover:underline"
                      title={`Add "${ing.name.trim()}" to pantry defaults so it auto-flags next time`}
                    >
                      <Icon name="pin" size={12} />
                      pin to defaults
                    </button>
                  )}
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => reorderIngredient(i, i - 1)}
                    disabled={i === 0}
                    className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[var(--radius-sm)] text-text-faint transition-colors hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent"
                    aria-label="move ingredient up"
                    title="Move up"
                  >
                    <Icon name="chevU" size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => reorderIngredient(i, i + 1)}
                    disabled={i === draft.ingredients.length - 1}
                    className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[var(--radius-sm)] text-text-faint transition-colors hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent"
                    aria-label="move ingredient down"
                    title="Move down"
                  >
                    <Icon name="chevD" size={15} />
                  </button>
                </div>

                {/* row 4: alternatives */}
                <input
                  placeholder="alternatives (comma-separated, e.g. 'olive oil, ghee')"
                  value={ing.alternativesInput}
                  onChange={(e) =>
                    updateIngredient(i, { alternativesInput: e.target.value })
                  }
                  className={`${inputSmCls} mt-[8px] w-full text-text-dim`}
                />
              </div>
            );
          })}
        </div>

        <div className="mt-[10px] flex flex-wrap items-center gap-[10px]">
          <Button variant="ghost" type="button" size="sm" onClick={addIngredient}>
            <Icon name="plus" size={15} />
            Add ingredient
          </Button>
          {pinnableFromDraft.length > 0 && (
            <button
              type="button"
              onClick={pinAllFlagged}
              className="inline-flex items-center gap-[6px] rounded-pill border border-sage/50 px-[11px] py-[6px] text-[12px] font-semibold text-sage transition-colors hover:bg-sage-tint"
              title={`Add to pantry defaults: ${pinnableFromDraft.join(", ")}`}
            >
              <Icon name="pin" size={13} />
              pin {pinnableFromDraft.length} pantry item
              {pinnableFromDraft.length === 1 ? "" : "s"} to defaults
            </button>
          )}
        </div>
      </Section>

      {/* ── Method ── */}
      <Section title="Method" note="Markdown numbered steps. Use ## headers for recipe sections.">
        <textarea
          rows={8}
          value={draft.recipe}
          onChange={(e) => setDraft({ ...draft, recipe: e.target.value })}
          placeholder={"1. Heat the oil…\n2. Add the onions…"}
          className={`${textareaCls} font-mono text-[13px] leading-[1.6]`}
        />
      </Section>

      {/* ── Notes ── */}
      <Section
        title="Notes"
        note={
          <>
            Persistent scratch pad. Shown as a sticky note above the ingredients on the dish
            page. Use for things like &ldquo;Finn won&rsquo;t eat this if there are
            mushrooms&rdquo; or &ldquo;usually 1.5× the chili&rdquo;.
          </>
        }
      >
        <textarea
          rows={3}
          maxLength={5000}
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          placeholder="Finn won't eat this if there are mushrooms"
          className={textareaCls}
        />
      </Section>

      {/* ── Save bar ── */}
      <div className="sticky bottom-0 z-[2] -mx-[1px] mt-1 flex items-center justify-between gap-4 border-t border-line bg-bg/95 py-[14px] backdrop-blur supports-[backdrop-filter]:bg-bg/80">
        <span className="flex items-center gap-[7px] text-[12.5px] text-text-faint">
          {!draft.title.trim() ? (
            <>
              <Icon name="close" size={14} />A title is required to save.
            </>
          ) : msg ? (
            <>
              <Icon name="check" size={14} style={{ color: "var(--sage)" }} />
              <span className="text-text-dim">{msg}</span>
            </>
          ) : (
            <>
              <Icon name="sparkle" size={14} />
              Structured so scaling &amp; shopping just work
            </>
          )}
        </span>
        <div className="flex items-center gap-[12px]">
          {(draft.id != null || onCanceled) && (
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY_DRAFT);
                onCanceled?.();
              }}
              className="text-[13px] font-medium text-text-faint transition-colors hover:text-text-dim"
            >
              Cancel
            </button>
          )}
          <Button variant="primary" type="submit" disabled={saving || !draft.title.trim()}>
            <Icon name="check" size={18} style={{ color: "var(--accent-ink)" }} />
            {saving ? "Saving…" : draft.id != null ? "Save changes" : "Save dish"}
          </Button>
        </div>
      </div>

      <datalist id="dish-form-standard-units">
        {STANDARD_UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <datalist id="dish-form-ingredient-names">
        {ingredientNameOptions.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Presentational helpers (V2 tokens)
// ---------------------------------------------------------------------------

// Shared input/textarea styling: raised surface-2 fill, hairline border, accent
// focus ring, cream text. Matches the prototype's `inputStyle` and the
// dish-view cook-log textarea.
const inputCls =
  "w-full min-w-0 rounded-[var(--radius-md)] border border-line bg-surface-2 px-[13px] py-[11px] text-[14.5px] text-text placeholder:text-text-faint transition-colors focus:border-accent-line focus:outline-none";
const inputSmCls =
  "rounded-[var(--radius-sm)] border border-line bg-surface-2 px-[10px] py-[8px] text-[13.5px] text-text placeholder:text-text-faint transition-colors focus:border-accent-line focus:outline-none";
const textareaCls =
  "w-full resize-y rounded-[var(--radius-md)] border border-line bg-surface-2 px-[13px] py-[11px] text-[14px] text-text placeholder:text-text-faint transition-colors focus:border-accent-line focus:outline-none";

function Section({
  title,
  note,
  count,
  children,
}: {
  title: string;
  note?: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section>
      <div
        className="mb-[4px] text-[11px] font-semibold uppercase tracking-[0.18em] text-accent"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {title}
        {count != null && <span className="text-text-faint"> · {count}</span>}
      </div>
      {note && (
        <p className="mb-[12px] text-[12px] leading-[1.45] text-text-faint">{note}</p>
      )}
      <div className={note ? "" : "mt-[12px]"}>{children}</div>
    </section>
  );
}

function FieldLabel({ children, hint }: { children?: ReactNode; hint?: string }) {
  return (
    <div
      className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-faint"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {children}
      {hint && (
        <span className="ml-[6px] font-normal normal-case tracking-normal text-text-faint/80">
          {hint}
        </span>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-[16px] first:mt-0">
      <div className="mb-[7px]">
        <FieldLabel hint={hint}>
          {label}
          {required && <span className="text-accent"> *</span>}
        </FieldLabel>
      </div>
      {children}
    </div>
  );
}

function ToggleCard({
  on,
  onClick,
  icon,
  iconFillWhenOn,
  label,
  sub,
}: {
  on: boolean;
  onClick: () => void;
  icon: "heart" | "link";
  iconFillWhenOn?: boolean;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex flex-1 items-center gap-[10px] rounded-[var(--radius-md)] border p-[11px_13px] text-left transition-colors",
        on ? "border-accent-line bg-accent-tint" : "border-line bg-surface-2",
      ].join(" ")}
    >
      <Icon
        name={icon}
        size={18}
        fill={iconFillWhenOn && on}
        style={{ color: on ? "var(--accent-2)" : "var(--text-faint)" }}
      />
      <div>
        <div
          className={["text-[13.5px] font-semibold", on ? "text-accent-2" : "text-text"].join(" ")}
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {label}
        </div>
        <div className="text-[11px] text-text-faint">{sub}</div>
      </div>
    </button>
  );
}

function FlagChip({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        "inline-flex items-center rounded-pill border px-[9px] py-[4px] text-[11px] font-medium transition-colors",
        on
          ? "border-accent bg-accent text-accent-ink"
          : "border-line bg-transparent text-text-dim hover:border-line-2 hover:text-text",
      ].join(" ")}
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {children}
    </button>
  );
}
