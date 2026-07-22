# Dinner Spinner — Batch Import: Feature Design Brief

> A brief for designing **one new feature's** UI. Hand it to an AI design tool as the source
> of truth for **WHAT** this feature must do and **HOW it should feel** — and a deliberate
> hands-off on **HOW it looks**. It is a **companion to the whole-app brief**
> (`docs/dinner-spinner-design-brief.md`): inherit the app's soul, dish model, and hard
> constraints from there; this brief adds only what's new for batch import.

> **Status: implemented design handoff.** The durable import engine and responsive V2 UI now
> ship in `app/add/batch-import.tsx` and `app/add/batch-panel.tsx`. This brief remains the
> capability/design contract; [`AGENTS.md`](../AGENTS.md) and the code own current mechanics.

---

## How to read this brief

**Fixed (the contract):** the job (§5), the data each moment shows, the actions, the states
(§6), the meaning of the new concepts (§4), and that it **feels like Dinner Spinner** (§3 +
whole-app brief §3).

**Free (yours to invent):** the shape of the upload/paste affordance, where/how the feature
is entered, how "Found X" is presented and confirmed, the entire progress visualization,
color, light/dark, type, components, density, iconography, motion, and all copy. See §8.

Three things to internalize:

1. **The feature is implemented, but its layout is not sacred.** A working responsive UI and
   durable server-side state machine exist today. A redesign may reinvent the surface while
   preserving the behavior and state coverage described here.
2. **It's organized by the job, not by screens.** Invent the screens and navigation.
3. **Batch import is the bulk sibling of "capture a recipe"** (whole-app brief §5.5). A
   document containing exactly one recipe stays in the same found-list confirmation flow with
   a count of one; single-recipe AI ingest remains a separate auto-save path.

---

## 1. The feature in one breath

**Batch import lets a cook bring an entire document full of recipes into their collection in
one move** — drop a file (or paste text), see how many recipes were found, confirm once, and
let the app import them all in the background, generating a photo for each. It turns "add 20
recipes" from 20 separate trips through the single-recipe flow into **one decision and a
progress you can walk away from.**

The soul is the app's own "remove the deliberation, keep the trust" thesis (whole-app brief
§1), at bulk scale: **bulk, but never careless.** You always see *what was found* before you
commit, and you always see *how it landed* afterward. The app does the tedious work; it never
becomes a black box that swallows your recipes.

---

## 2. Who it's for and where it lives

**The user** is the same home cook, in a specific moment: **seeding or migrating a
collection** — moving from another app, importing a file of family recipes, pasting a long
note of dishes. It's occasional, often nearly one-time, and is sometimes **the very first
thing a brand-new account does** (the empty-collection first-run — whole-app brief §6).

**Where it lives:** inside the existing authenticated, private app, as part of **"add a
recipe"** (whole-app brief §5.5). It should be discoverable from the same place a single
recipe is added, and read clearly as the *bulk* version of that job.

**Device weighting — co-equal phone + desktop.** This is a **deliberate exception to the
app's mobile-first default**, decided for this feature. Bulk import is often a lean-back,
at-a-desk task (that's where files live, and a long "Found 20 recipes" list wants width) —
*and* pasting a big block of text on a phone must be just as first-class. Design **both**
deliberately; neither is a reflow afterthought.

**Posture:** logged-in, private, per-user — like the rest of the app. There is **no
public/share dimension** to this feature. Inherit the whole-app non-goals (no billing, ads,
or marketing — whole-app brief §7).

---

## 3. How it should feel — *the app's warmth, in a calm bulk utility*

Inherit the app's personality wholesale (whole-app brief §3: *appetizing warmth held with
editorial restraint*, with an equally-valid calm-utilitarian alternative — this utility-
flavored flow may lean that way). On top of that, hold these batch-specific feelings:

- **Bulk but trustworthy.** Importing many at once must never feel like a careless dump. The
  **"Found X" beat** and the **honest outcome** are the trust anchors — the same transparency
  that separates "the app helped me" from "the app did something to my data."
- **A calm, watchable wait.** A big import genuinely takes minutes, and photos land later
  still. The progress is a **first-class experience, not a spinner** — oriented, paced, even
  a little satisfying to watch fill in. (This is the whole-app brief §6 "long wait" challenge
  at its largest scale.)
- **Walk-away-able.** Starting it and leaving should feel *safe*; returning to find it done —
  or still going — is the **expected rhythm**, never an error.

As always, the visual language is entirely yours; §3 fixes the *vibe*, not the palette, type,
or components.

---

## 4. The mental model the UI must make legible

The **dish** and its **structured ingredients** are unchanged — defer to the whole-app brief
§4. Batch import introduces a few **new concepts** the UI must make obvious:

- **The source document** — one body of text the user provides: an uploaded text-readable
  file (a `.txt` / `.md` / `.json` / similar) **or** pasted/typed text. Its internal format
  is irrelevant to the user — the app simply *reads it as text and finds recipes in it.*
  Meaning: "the thing you're importing from."
- **A detected recipe** — one recipe the app believes it found inside the document,
  identified by a **title** before it is fully parsed. Pre-import these are **candidates**: a
  count and a list of titles, *not yet real dishes.* Meaning: "how many, and roughly which,
  the app saw."
- **The import (the batch process)** — the running, **durable** process of turning detected
  recipes into real dishes-with-photos. It has a lifecycle the UI must express: *analyzing
  the document → found & awaiting confirmation → importing → done.* It is **resumable** — the
  user can leave and return to a live view of the *same* import.
- **The two-speed result.** Within an import, each recipe goes **pending → imported**, and
  **its photo arrives on a slower track.** A dish can be fully imported and usable while its
  image is still being made, then quietly gain it. The UI must be able to say: "this one's
  in; its photo is coming."
- **Partial success.** An import can finish **mixed**: most recipes imported, a few failed (a
  malformed chunk, a parse error). A failed *photo* never fails a dish (it just lands
  image-less, regenerable later — whole-app brief §5.6). The outcome concept is **"X of Y
  imported,"** with any failures **named and recoverable**, never silently dropped.
- **Open-ended scale.** A document might hold three recipes or many dozens. Every surface
  must stay graceful and scannable whether it's "Found 3" or "Found 60."

---

## 5. The jobs to be done

### 5.1 Bring in a batch of recipes from a document

*Who/when:* a cook seeding or migrating a collection; sometimes brand-new with zero dishes.

- **See:** an inviting way to provide a document — **pick/drop a file or paste text** —
  discoverable from where a single recipe is added; a light sense of what's acceptable (a
  text document or pasted recipes, not a spreadsheet); after submitting, an honest
  **analyzing** state while the app reads the document and finds recipes (a few seconds,
  longer for a big doc); then the headline: **how many recipes were found** ("Found 20
  recipes") with enough to recognize it worked (the detected **titles**), and a single,
  clear **confirm to import all**.
- **Do:** provide a file or paste text; submit for detection; read the found count and
  titles; **confirm the whole batch in one action**; or **back out** and start over with a
  different document if the result looks wrong (it found one giant "recipe," or 200 nonsense
  ones). Note explicitly: **there is no per-recipe selection or editing at this step** — by
  design it's an all-or-nothing "import these" decision; refining an individual dish happens
  later on its normal edit page.
- **States:** idle/empty (nothing provided — invite a file or paste, ideally with a word on
  what works); analyzing (the detection wait); **found N** (the confirm moment — the pivotal
  beat); **found exactly 1** (the same confirmation flow, calmly showing a count of one);
  **found 0 / unreadable** (the app couldn't find recipes — clear, non-blaming, try-again);
  **a very large N** (still calm and confirmable); detection failed/timed out (recoverable);
  not-signed-in (gated like the rest of the app).

### 5.2 Watch the import finish, and deal with how it lands

*Who/when:* right after confirming, and on any return visit while it's still running or after
it's done. The passive, monitor-and-recover half of the job.

- **See:** a live, **resumable progress** view — overall progress ("12 of 20 imported"), a
  sense of the **current phase** (importing recipes; then photos arriving), and **per-recipe
  status filling in** (pending → imported, each becoming an openable dish; photo pending →
  photo arrived). On completion, a clear **outcome summary**: how many imported, how many
  failed and which, and a path onward. "Photo still coming" must read as reassuring, not
  alarming.
- **Do:** watch it progress; **navigate away and come back** to the same live import; **open
  an already-imported dish** without waiting for the rest; at the end, jump into the
  collection / the new dishes; for any **failed** recipe, **recover** — retry it or fall back
  to importing that one manually (it must never just vanish); optionally start another
  import.
- **States:** importing (the long, watchable, paced working state — first-class);
  navigated-away-and-returned (resume to live progress — the expected rhythm); a dish
  imported but **photo still pending** (the two-speed result, shown calmly); finished
  **all-success** (a light celebration); finished **partial-success** ("18 of 20 — here are
  the 2 that didn't make it," recoverable); finished **all-failed** (clear, recoverable, not
  a dead end); the import **interrupted/expired** (honest, with whatever imported preserved
  and a way forward); **returning long after** it finished (the new dishes are simply in the
  collection — the import view must not trap them there).

---

## 6. Cross-cutting states and moments

The feature lives or dies here.

- **Empty / first-run.** Batch import is a prime answer to the brand-new **empty collection**
  (whole-app brief §6): "got a file of recipes? bring them all in at once." Design that
  on-ramp deliberately — it may be a user's very first action.
- **The two long waits.** **Detection** (seconds, sometimes more) and **the import itself**
  (minutes; photos later still). Both deserve honest, oriented working states — never a bare
  spinner. The import wait is large and **returned-to**.
- **Error / degraded — specific at every phase.** Unreadable/empty document; nothing-found;
  detection-failed; **some-recipes-failed** (partial); all-failed; interrupted mid-import;
  image generation unconfigured or refusing (dishes still import — just image-less; say so).
  **Never a silent failure** — failures are always named and recoverable.
- **Sparse / uneven input.** A document with one recipe, with sixty, with messy formatting,
  with a non-recipe blob mixed in. The flow stays graceful and honest across all of it.
- **The pivotal "needs-you" moments.** Two, and they deserve special care: the **"Found X —
  import all?" confirmation** (the single decision point — make it trustworthy), and the
  **partial-success outcome** (handing the few that failed back to the cook to rescue).

---

## 7. Hard constraints (the only ones)

- **Inside the existing multi-user, authenticated, private app.** No public/share surface for
  this feature; inherit the whole-app non-goals (no billing/marketing — §7 there).
- **Co-equal phone + desktop** (the deliberate exception to mobile-first, for this feature):
  file-pick/drop and the multi-recipe progress list want desktop width; paste-on-phone stays
  equally first-class. Both designed on purpose.
- **Light and dark both real** (whole-app brief §7).
- **Legibility at open-ended scale.** The found-list and the progress list must stay scannable
  and unambiguous at N=3 and N=60+ alike — counts, statuses, and what-failed-and-why can't
  blur together.
- **Honest about a long, durable, resumable, two-speed process.** The design must hold a
  minutes-long, walk-away-able, returned-to import and a **dish-then-photo** result without
  ever looking stuck or claiming done before it is.
- **One decision granularity.** Detection → a **single confirm of the whole batch** (no
  per-recipe checkboxing or editing at confirm). Per-dish refinement is deferred to the
  existing edit flow.

---

## 8. Explicitly free — your creative latitude

Everything visual and structural for this feature is yours:

- **The upload/paste affordance** — drop zone, file button, paste area, or one unified thing.
- **Entry & placement** — how and where batch import is reached from the add flow.
- **The "Found X" review + confirm** — how the count and titles are shown and committed.
- **The entire progress visualization** — a list, a grid of cards filling with photos, a
  counter, a timeline — your call; and how the **two-speed photo arrival** is expressed.
- **The outcome & recovery** — how partial-success and per-recipe rescue are presented.
- **Color, light/dark, typography, components, density, iconography, motion, and all copy.**

**The only sacred things:** every moment in §5 and every item in the appendix stays
*possible*, the §4 concepts stay **legible**, and it **feels like §3 / the app.**

---

## Appendix — capability coverage checklist

A coverage contract for this feature. Keep every item **possible**; *how and where* is
entirely yours. Grouped by function, not by screen.

### A. Provide the document
- [ ] Enter batch import from where a single recipe is added; read it as the bulk version of "add a recipe"
- [ ] Provide a recipe source as an uploaded text-readable file (`.txt`/`.md`/`.json`/similar) — pick or drag-drop
- [ ] OR provide it as pasted/typed text — equally first-class, especially on phone
- [ ] Understand at a glance what's acceptable, and get a gentle, non-blaming message when the input isn't usable
- [ ] Submit the document and see an honest "analyzing / reading" working state during the wait

### B. Review & confirm the found recipes
- [ ] See how many recipes were found ("Found N recipes")
- [ ] See the detected titles — enough to trust the result
- [ ] Confirm the whole batch in a single action (all-or-nothing — no per-recipe select/edit here, by design)
- [ ] Back out and start over with a different document if the count/contents look wrong
- [ ] When exactly one recipe is found, keep the same found-list confirmation flow with a count of one
- [ ] Handle found-zero / unreadable / detection-failed clearly and recoverably
- [ ] Stay calm and confirmable whether N is 3 or 60+

### C. Run & monitor the import (background, resumable)
- [ ] Kick off a background import of all confirmed recipes with one confirm
- [ ] See live overall progress ("12 of 20 imported") and the current phase
- [ ] See per-recipe status fill in (pending → imported), each imported dish openable immediately
- [ ] See photos arriving on a slower track (dish imported now, photo lands shortly after) without it reading as broken
- [ ] Navigate away and return to the same live import (resumable) — not be forced to sit and watch
- [ ] Open an already-imported dish before the rest finish

### D. Outcome & recovery
- [ ] See a clear end-of-import summary: how many imported, how many failed
- [ ] See exactly which recipes failed (named, never a silent drop)
- [ ] Recover a failed recipe — retry it, or fall back to importing that one manually
- [ ] Understand that a dish whose *photo* failed still imported fine and can get a photo later
- [ ] From the outcome, jump into the collection / the newly-added dishes
- [ ] Returning long after completion, find the new dishes already in the collection (not trapped in the import view)
- [ ] Start another import

### E. Cross-cutting
- [ ] Batch import offered as a first-run on-ramp for a brand-new empty collection
- [ ] Honest, oriented working states for both the short (detection) and long (import) waits
- [ ] Light & dark; co-equal phone & desktop; legible at any N; never a silent failure
- [ ] Image-generation-unconfigured handled gracefully (dishes import image-less, said plainly)

---

*Companion to the whole-app redesign brief (`docs/dinner-spinner-design-brief.md`): inherits
the soul (§3), the dish/ingredient mental model (§4), the capture-a-recipe (§5.5) and
dish-photo (§5.6) jobs, the cross-cutting states (§6), and the hard constraints (§7) from it.
Backs roadmap item `QNGIkXIN62Sc` — "Batch import recipes from an uploaded document"
(dinner-spinner). Greenfield: no current UI; the brief fixes meaning + feel, not look.*
