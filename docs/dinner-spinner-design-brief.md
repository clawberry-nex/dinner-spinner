# Dinner Spinner V2 — UI Redesign Brief

> A brief for a **full visual redesign**. Hand this to an AI design tool as the source of
> truth for **WHAT** the product must do and **HOW it should feel** — and as a deliberate
> hands-off on **HOW it looks**. Reinvent the surface freely; keep the substance intact.

> **Status: redesign handoff reconciled with the shipped product.** This brief fixes capability
> coverage and product character, not current layout. When implementation details matter,
> [`AGENTS.md`](../AGENTS.md) and the code are authoritative.

---

## How to read this brief

**Fixed (don't touch the substance):** the jobs people come to do (§5), the data each job
needs, the actions it must allow, the states it can be in (§6), the domain's mental model
(§4), and the product's personality (§3). These are the contract.

**Free (yours to invent):** layout, information architecture, navigation, color, light/dark
treatment, typography, components, density, iconography, motion, data-visualization, and the
exact words on screen. See §8 for the explicit license.

Three things to internalize before you start:

1. **This brief is organized by jobs-to-be-done, not by the current screens.** Any reference
   to how the app works today is **coverage information only — never a layout constraint.**
   Don't preserve the current screen map; invent your own. The appendix is a checklist of
   capabilities that must stay *possible*, not a list of screens to recreate.
2. **The discovery mechanic is on the table.** Today the app literally spins a wheel to pick
   a dish. You are *not* required to keep a wheel, a spin, or any particular gesture. What's
   fixed is the *job* — "help me decide what to cook tonight, with a bit of serendipity, and
   tell me why" — not the toy that does it. Reinvent the mechanic if you have a better one.
3. **There are no screenshots, colors, or layouts in this brief on purpose.** Nothing here
   should anchor your eye. Design from meaning.

---

## 1. The product in one breath

**Dinner Spinner turns "what's for dinner?" from a nightly negotiation into a single,
trustworthy decision.** It holds your personal collection of recipes; it knows which ones
you love and which you cooked two days ago; it helps you *decide* (and tells you exactly why
it suggested what it did); it scales the recipe to tonight's table; and it rolls every dish
you're planning into one pantry-aware shopping list that lands on your phone via Todoist.

The core thesis — the soul of the thing — is **"remove the deliberation, keep the trust."**
The app is happy to choose for you, but it is never a black box: every suggestion comes with
a plain-language reason, and you always stay in control of the servings, the plan, and what
actually ends up on the list. It is equal parts *delightful little ritual* ("spin me a
dinner") and *quietly capable daily utility* (scale, plan, shop). Hold both.

---

## 2. Who it's for and where it lives

**The user** is a home cook curating their own recipe collection — a personal tool, used
daily, mostly by one person but built multi-user. People sign in; a small allowlist gates
who can join. So unlike a single-user toy, this product genuinely has **accounts, sign-in,
onboarding, and a public-sharing layer** — design them, don't skip them. (It does *not* have
billing, ads, or marketing surfaces — see §7.)

**Where it lives:** a web app, installable as a PWA. The primary context is **a phone in a
kitchen** — often propped on a counter mid-cook, one hand free, possibly offline mid-recipe.
It is installed to the home screen and expected to feel like a native app (edge-to-edge under
the notch/home-indicator, immersive cook screen, home-screen icon, offline fallback).

**Device weighting: mobile-first.** Phone is the first-class design target. Desktop is a
**deliberate secondary** adaptation (the browse library and the week-plan in particular
benefit from width) — design it on purpose, but let the phone lead every decision.

**Trust/privacy posture:** most of the app is private and login-walled. A deliberate sliver
is public: a cook can share a single dish or their whole profile by link, readable by anyone
with no account. Those shared pages are **noindex** — share-by-link, not SEO. Treat public
share surfaces as clean standalone pages, not "the app with a guest pass."

---

## 3. How it should feel — *appetizing warmth, held with editorial restraint*

The owner's gut is a blend of **warm & appetizing** and **refined & editorial**, and they've
explicitly asked to *also see a contrasting calm-utilitarian take.* So this section has a
**primary direction** and a **second direction worth exploring** — by design, not indecision.

### Primary direction — warm-editorial

Make food the hero and make the page feel *considered*, like a beautiful modern cookbook you
actually keep in the kitchen. Appetizing, a little tactile, a little joyful — opening it
should feel good. But disciplined: generous breathing room, typographic confidence, nothing
twee or cluttered. The warmth comes from the content (the dishes, the photos, the ritual of
choosing), not from decoration piled on top.

Hold these **productive tensions** explicitly — don't resolve them by going flat:

- **Appetizing ↔ restrained.** Warm enough to make you hungry; calm enough to read a dense
  ingredient list without strain. Don't let warmth become noise; don't let restraint become
  cold.
- **Delightful ritual ↔ daily utility.** The "decide what to cook" moment should feel like a
  small, pleasurable event — a flourish is welcome here. But the planning and shopping work
  is a *tool*, and a tired cook needs to get from "these 4 dishes" to "list on my phone"
  fast. The personality can be loudest at the moment of decision and quietest in the
  spreadsheet-shaped work.
- **Personal ↔ shareable.** It's mostly an intimate, private tool; but the public share
  surfaces should feel like a tastefully plated standalone page you'd be proud to send.

### Second direction worth exploring — calm, utilitarian operator's console

As an alternative cut, show the same product as a **fast, dense, get-in-get-out meal-planning
instrument** — function foremost, ornament minimal, optimized for a cook who wants to plan
and shop in as few taps as possible. The owner wants to compare this against the warm-editorial
direction. Treat it as a real, fully-considered alternative, not a throwaway — same jobs, same
data, different temperature.

In both directions, **the visual language is entirely yours to own.** §3 fixes the *vibe*,
not the palette, the type, or the components.

---

## 4. The mental model the UI must make legible

This is the hardest part of the design. Dinner Spinner runs on a handful of domain concepts
that the UI must make obvious *at a glance*, defined here by **meaning**, never appearance.

### The dish and its structured ingredients

- **Dish** — the core unit: a recipe you can decide-on, scale, cook, plan, and share. It has
  a title, optional subtitle, a cooking **method** (written as steps), a list of structured
  **ingredients**, free-text **tags**, a **base serving count**, a photo, and some state
  (favorite, public/private, notes). Owned by exactly one person.
- **Structured ingredient (not a text line).** Every ingredient is decomposed, and this
  decomposition is what makes scaling, shopping, and diet-detection work. The fields and what
  they *mean*:
  - **name** — the bare purchasable thing, singular, in canonical English ("green chili",
    "aubergine"). This is the key everything joins on (shopping aggregation, pantry matching,
    diet classification). Colour that changes the product is part of the name — "green chili"
    ≠ "red chili".
  - **descriptor** — a size/quality modifier that changes *what you'd buy* ("small", "large",
    "ripe"). Shown on the shopping list. ("fresh" is never a descriptor — it's implied.)
  - **preparation** — cut/cook prep ("thinly sliced", "peeled and diced"). Shown on the dish,
    **dropped from the shopping list** because it doesn't change what you purchase.
  - **quantity + unit** — how much, at base servings.
- **The three behavioral flags** — each changes how an ingredient behaves downstream, and the
  UI must make each legible where it matters:
  - **pantry** — "I always have this" (salt, oil, flour). Shown on the dish but **excluded
    entirely from the shopping list and Todoist.** The user curates which names count as
    pantry.
  - **scalable = false ("fixed")** — the quantity does *not* scale with servings (1 bay leaf
    stays 1 bay leaf whether you cook for 2 or 12). The scaler is a no-op for it.
  - **optional** — a garnish/"to serve" item. **Excluded from the shopping list by default**,
    with an opt-in toggle when planning. (pantry + optional compose — excluded by both.)
  - **alternatives** — swap-ins ("butter, or olive oil"). Informational; only the primary is
    shopped for.
  - **section** — which part of a multi-part recipe an ingredient belongs to ("Dough",
    "Filling"). **Display grouping only** — it never splits the shopping list.

### Servings & scaling

- **base servings** — the serving count the stored quantities are written for. The source of
  truth and the divisor for all scaling.
- **servings** — the transient count the cook chooses *right now* (on the dish, in cook mode,
  per meal-plan entry). Scaling = `quantity × servings ÷ base servings`, except for fixed
  ingredients. The UI must make it effortless to change tonight's serving count and watch
  every quantity re-figure live — and to see at a glance when you've deviated from base.

### Why-this-dish: the decision signals (the heart of the product)

Even though the *mechanic* of choosing is free (§8), these **signals must remain legible**,
because "trust the suggestion" is the soul (§1):

- The app biases its suggestion toward dishes you **love** and away from ones you **just
  cooked** or **rated poorly**. Concretely: a high average rating makes a dish much more
  likely; a low rating actively suppresses it; favoriting boosts an as-yet-unrated dish;
  cooking something recently makes it briefly unlikely (fading back over ~two weeks); but
  *nothing is ever fully impossible* — there's always a small chance of a surprise.
- **The reason is always shown.** Whatever the decision mechanic, the user must be told, in
  plain language, *why this dish* — the pool it was drawn from and which factors nudged it
  ("you rated this 4.5★; you cooked it 3 days ago"). This transparency is non-negotiable; it's
  what separates "the app chose for me" from "the app is a slot machine."

### Cooking & history

- **favorite** — a per-dish ❤/★ you toggle; surfaces a dish more and lets you filter to it.
- **cook log** — an append-only record that you cooked a dish on a date, with an optional
  1–5★ **rating** and an optional **note** ("too salty, halve the soy"). From these the app
  derives **last-cooked**, **average rating**, and **how many times rated** — the signals that
  feed the decision and the dish's history. (Cook entries are write-once and time-stamped at
  save — there's no editing or back-dating a past cook.)
- **notes (dish scratch-pad)** — durable per-dish notes, distinct from a single cook's note
  ("Finn won't eat this with mushrooms", "usually 1.5× the chili"). A standing reminder.

### Diet & allergens (derived, never stored)

- The app computes **vegetarian / vegan** status and an **allergen "contains" set** (dairy,
  eggs, gluten, nuts, fish, shellfish, soy) *live from the ingredient names*. It's
  **permissive by default** — an unknown ingredient never disqualifies a dish — so these are
  advisory "good to know" signals, not guarantees. Used both as at-a-glance chips on a dish
  and as filters when browsing.

### Collection, sharing & identity

- **tags** — free-text labels for filtering. Filtering is **AND**: select two tags and a dish
  must have *both*.
- **public / private** — per dish, **public by default**. Public dishes are readable by
  anyone with the link and appear on your shareable profile; private dishes are yours alone
  (and simply don't exist to anyone else).
- **owner vs visitor** — the same dish or profile page serves two audiences. The **owner**
  gets every control (edit, favorite, cook, plan, log, notes, history). A **visitor**
  (anonymous or any other signed-in user) gets a clean read-only page — a shared recipe card,
  with attribution back to the cook's public profile.
- **handle / profile** — every cook has a unique public **handle** (`/u/yourname`), a display
  name, an avatar, and a one-line bio. The handle is the share key. It can be changed exactly
  once (and doing so breaks old links — a deliberate, warned-about moment).

### Planning & shopping

- **meal plan** — a set of dishes you intend to cook, each with its own serving count
  (independent of the dish's base). Dishes can be loosely slotted across the **days of the
  week** or left in a **pool** — *but day assignment is purely organizational; every planned
  dish counts toward the shopping list regardless of whether it has a day.*
- **shopping list** — the consolidated, deduplicated result of all planned dishes: quantities
  scaled per entry, then **merged across dishes** where they can be (weights merge via grams,
  volumes via millilitres; things that can't merge sensibly — "2 cans + 400 ml coconut milk" —
  are shown grouped, not wrongly summed). Pantry items drop off; optional items drop off
  unless you opt them in.
- **pantry check / out-of-stock** — pantry staples used by the plan are shown separately as a
  "you have these" reference; if you notice you're actually *out* of one, you can bump it onto
  the list just for this trip.
- **Todoist push** — the finished list goes to the user's own Todoist project as individual
  tasks, so it's on their phone at the store.

### Account, data & app-shell concepts

- **theme** — a real, first-class feature: System / Light / Dark, applied instantly with no
  flash. (Both light and dark must be fully designed.)
- **recipe language** — new AI-ingested recipes can be written in the user's chosen language
  (English, Dutch, German, French, Spanish, Italian); ingredient *names* always stay English
  under the hood so shopping/pantry/diet logic stays language-neutral.
- **backup** — the user can export their whole collection as a file and re-import it; the only
  data-portability surface.
- **placeholder identity** — a dish with no photo is still always representable (today: its
  emoji over an accent-colored gradient). Every dish must have a dignified visual even with
  no image, no subtitle, no tags.

---

## 5. The jobs to be done

The core of the brief. One subsection per job. Each lists who/when, what they **need to see**,
what they **need to do**, and the **states** the job can be in. These are requirements and
intent — *not* layouts. Cover every job; invent the screens and navigation yourself.

### 5.1 Decide what to cook tonight

*Who/when:* the cook, standing in the kitchen at 6pm, not wanting to deliberate. The signature
moment of the product.

- **See:** a suggestion of *one* dish to make, drawn from their collection; the ability to
  narrow the candidate set first by mood/constraint (tags, and/or dietary needs); a sense of
  how big the candidate pool is and whether it's narrowed; and — critically — a **plain
  reason why this dish** (pool + the factors that nudged it: loved, highly-rated, not cooked
  recently).
- **Do:** trigger the decision; narrow by tag(s) (AND semantics) before deciding; re-decide
  /try again instantly if the suggestion doesn't appeal; open the suggested dish; have their
  chosen filters remembered next time.
- **States:** brand-new account with **zero dishes** (nothing to decide from — a first-run
  moment that should invite adding a recipe); filters that exclude everything (nothing
  matches); a single eligible dish; a large collection; a dish with no photo (still must look
  good as the result); the decision in-progress (a beat of anticipation is welcome — this is
  where delight lives).
- **Free to reinvent:** the *mechanic* entirely. Wheel, shuffle, card-flip, dice, a "surprise
  me" button, something new — your call. Keep the *bias* (loved-and-not-recent) and the
  *transparency* (why this one).

### 5.2 Browse and find a dish in my collection

*Who/when:* the cook who knows roughly what they want, or is curating.

- **See:** their whole collection; each dish with its art/photo, title, subtitle, tags, when
  it was **last cooked** (including "never cooked"), favorite state, and whether it's already
  in the plan; a count of how many match the current view; which dishes are in the plan with a
  jump to it.
- **Do:** search by name/subtitle; filter by tag(s) (AND), by **diet** (vegetarian / vegan /
  no dairy / no gluten / no nuts), and to favorites only; see and clear active filters;
  favorite a dish inline; add/remove a dish to the plan inline; open any dish.
- **States:** loading; empty collection ("no dishes yet"); no matches for the current
  filter/search (distinct from empty collection); dishes missing photos/subtitles/tags (sparse
  but still tidy); a heavily-filtered long collection. *(Today the list is alphabetical with no
  sort control and renders differently on phone vs desktop — you may rethink sort and layout
  freely, but the filter/search/favorite/add capabilities must remain.)*

### 5.3 Read and scale a recipe

*Who/when:* deciding whether to cook this, or prepping to.

- **See:** the dish's photo, title, subtitle, tags, and **at-a-glance diet/allergen chips**;
  the ingredient list with every quantity **scaled to the chosen servings**, showing
  descriptor + name + alternatives, with pantry items de-emphasized, fixed-quantity items
  marked as not-scaling, and optional items marked; ingredients grouped by recipe **section**
  when the recipe has parts; the cooking **method** as clear numbered steps (grouped under
  section headings when present); and, for the owner, footer history (last cooked, average
  rating) and a pinned **notes** scratch-pad.
- **Do:** step the serving count up/down and watch quantities re-figure live; reset to base;
  have the chosen servings remembered for next time; (owner) favorite, log a cook, open cook
  mode at these servings, add to the plan at these servings, jump to edit; (visitor) follow
  attribution to the cook's public profile.
- **States:** owner vs visitor (visitor sees a clean read-only card — no edit/favorite/cook/
  plan/notes/history — and the app's nav chrome falls away so it reads as a standalone share
  page); never-cooked (no history footer); no ingredients; no method; no notes; a private dish
  viewed by a non-owner (it simply doesn't exist to them); servings deviating from base (offer
  a reset).

### 5.4 Cook a dish hands-on

*Who/when:* phone propped on the counter, hands busy, mid-recipe. An **immersive, full-screen**
context with no app navigation in the way, and the screen kept awake.

- **See:** the method one section at a time as tappable steps with per-step "done" tracking; a
  persistent **scaled ingredient reference** alongside (grouped by section, pantry
  de-emphasized, optional marked); the ability to adjust servings on the fly; inline
  **ingredient references** within a step that, when tapped, jump to and flash the exact
  ingredient(s) that step needs; inline **timer offers** for any duration mentioned in a step
  ("15 min") that start a real countdown on one tap; a panel of running timers, each labeled,
  counting down, that **alarm (sound + visual)** when done.
- **Do:** advance through steps and mark them done; change servings; tap an ingredient mention
  to locate it; start one or several concurrent timers from steps; dismiss a finished timer;
  exit cleanly back to the dish.
- **States:** owner-only (no shared/visitor cook mode); recipe with no parseable steps
  (ingredient reference still useful); recipe without precise ingredient-links (highlighting
  degrades gracefully); timers running while the tab is backgrounded (must stay accurate on
  real elapsed time); device without screen-wake support (warn, fall back); audio blocked
  (timer still completes visually); everything in this mode is ephemeral (a reload loses
  progress) — design with that fragility in mind.

### 5.5 Capture a recipe into my collection

The most important *creation* job, with two paths that converge.

**5.5a — AI ingest (the default, fast path).** *Who/when:* the cook with a recipe somewhere
already — a block of pasted text, a URL, a free-text description, or a **photo** of a cookbook
page / screenshot.

- **See:** an input that invites paste / URL / description and/or a photo (camera or library),
  with a preview; while it works, an honest **progress** experience — a specific, changing
  label of what's happening right now ("looking at the photo", "writing the recipe", "saving",
  "generating image") and an elapsed-time sense, because this legitimately takes 60–90+
  seconds; on success, landing on the finished dish (with its generated photo).
- **Do:** submit text and/or one photo; wait through a long-running parse; retry on failure
  and optionally inspect the raw model output; resume an interrupted ingest after accidentally
  closing the tab. A successful parse is auto-saved and opens as a finished dish — there is no
  intermediate AI-review form.
- **States:** idle (nothing entered); working (a *minute-plus* — the working state is a
  first-class screen, not a spinner); failed (clear error, raw-output peek, retry); job
  expired; "taking unusually long"; parsed-but-invalid; ingest not configured; the photo lands
  later in the background if image-gen is slow (degraded-but-fine).

**5.5b — Author or refine manually.** *Who/when:* typing a recipe from scratch, correcting a
previously saved AI-ingested dish, or editing any existing dish. Manual authoring is a separate
mode, not a review step inside AI ingest.

- **See/Do:** edit the title (the one required field), subtitle, tags (with suggestions from
  tags you've used), base servings, the photo (paste a URL *or* generate one with AI), an
  image-description prompt, emoji/accent, favorite and public toggles, the recipe method
  (markdown steps), and the notes scratch-pad. Build the **ingredient list** row by row, each
  with quantity / unit / descriptor / name / preparation / section / alternatives and the
  pantry / fixed / optional flags — with autocomplete for units and ingredient names, and
  pantry auto-flagging. Reorder ingredients. Pin newly-flagged pantry items into your curated
  pantry list. Delete the dish (with confirmation).
- **States:** create vs edit; validation (missing title blocks save); "save before you can
  generate a photo"; blank ingredient rows quietly
  dropped; suggestion sources still loading (form still works). *This form carries a lot of
  structured meaning — making the ingredient model approachable rather than a spreadsheet is a
  real design challenge (see §4).*

### 5.6 Give a dish a photo

*Who/when:* any time a dish has no photo or an unflattering one.

- **See:** the current photo (or a dignified placeholder); the option to generate one with AI
  or paste a URL; a clear **working state** while generation runs (it takes 30–60s); the new
  photo appearing when ready; an editable "image description" that drives the generated look.
- **Do:** trigger AI generation and watch for the result; paste a manual URL; (power-user)
  bulk-backfill photos for all dishes missing one, or regenerate all.
- **States:** generating; done; failed (e.g. the model refused, or no provider is configured —
  say so clearly); slow (offer "refresh in a moment"); newly-created dishes get a photo
  automatically in the background (so a dish may be briefly imageless, then quietly gain one).
  Generated photos follow a consistent house style so a collection looks like it belongs
  together — preserve that "they go together" quality however you present it.

### 5.7 Remember and rate my cooking

*Who/when:* just finished cooking, or reflecting on a dish.

- **See:** a dish's cooking history (each cook's date, rating, note), its average rating and
  last-cooked at a glance, and its durable notes scratch-pad.
- **Do:** mark "I cooked this" with an optional 1–5★ rating and an optional note (a bare
  date-only log is fine); favorite/unfavorite; keep durable per-dish notes (edited on the edit
  page). New logs immediately update the dish's history and the signals that drive the
  decision (§5.1).
- **States:** never cooked; cooked but never rated; long history; a cook log is append-only and
  time-stamped at save (no edit/backdate — design the logging affordance around that).

### 5.8 Plan the week and build a shopping list

*Who/when:* the weekly shop, or assembling a few nights at once. The product's other center of
gravity, opposite the decide-tonight ritual.

- **See:** the dishes currently planned, each with a serving count and a link to the recipe;
  an optional arrangement across the **days of the week** plus an unassigned **pool**; the
  consolidated **shopping list** (quantities scaled and merged across dishes, multi-unit items
  grouped sensibly); a separate **pantry check** of staples you already have; how many tasks a
  Todoist push will create.
- **Do:** add/remove dishes (adding mostly happens from dish pages); set per-dish servings;
  slot a dish to a day or back to the pool; reset all day assignments; clear the whole plan;
  toggle whether **optional** ingredients are included; mark a pantry staple as **out-of-stock**
  to bump it onto the list for this trip (and undo); **push the list to Todoist**.
- **States:** empty plan (a clear first-run nudge to go decide/add a dish); a planned dish that
  no longer exists (silently drops); a list that resolves to nothing (everything's pantry/
  skipped-optional); no pantry items; nothing slotted to days yet; pushing (working); Todoist
  not configured / wrong project (actionable error); partial push. The plan follows the user
  across devices, and degrades to local-only when offline/unauthenticated.

### 5.9 Share my cooking and have a public identity

*Who/when:* sending a recipe to a friend, or having a browsable public page.

- **See (as owner):** a public profile at your handle with your name, avatar, bio, and a grid
  of your dishes — *all* of them, with a clear marker on the private ones; your settings entry
  point. **See (as visitor):** a clean public profile showing only that cook's public dishes,
  and clean standalone dish pages, with attribution — no app chrome, no account required.
- **Do:** control each dish's public/private state; edit your handle (once, with a clear
  warning that old links will break), display intent, and bio; reach your own owner-home and
  from there your public page; share by link.
- **States:** owner vs visitor on the same URLs; owner with no dishes vs visitor seeing a cook
  with no *public* dishes (two different empty states); handle already renamed (locked);
  unknown handle (doesn't exist). A "Friends — coming soon" idea (following other cooks,
  pulling their public dishes into your plan) is a known future direction — you may gesture at
  it or leave room for it, but it isn't built.

### 5.10 Get in and install

*Who/when:* first arrival, returning sign-in, or installing to the home screen.

- **See/Do:** sign in with Google or email+password; sign up (gated by an allowlist) and be
  dropped straight into the app; land back where you were headed after signing in; install the
  app to the home screen (a one-tap native prompt on Android; clear manual instructions on
  iOS); read an offline fallback when the network drops, reassured that recently-opened dishes
  still work, with a way back in.
- **States:** allowed vs not-allowed email (deliberately vague sign-in error that doesn't leak
  which); already-registered; auto-sign-in-after-signup failing (fall back to manual);
  installable vs already-installed vs previously-dismissed (never nag twice); offline.

### 5.11 Manage my account and data

*Who/when:* settings, occasional.

- **See/Do:** see who you're signed in as and sign out; pick the theme; choose your recipe
  language; change your password (only if you have one); connect/disconnect your own Todoist
  (token + project); **curate your pantry list** (add/remove the ingredient names you always
  have, which then auto-drop from shopping lists); **export and import a backup** of your data,
  understanding before you import exactly what merges vs replaces.
- **States:** Google-only account (no password section); pantry empty; Todoist unconfigured;
  import: confirm, validate, show what changed; nothing here is destructive without a clear
  heads-up.

---

## 6. Cross-cutting states and moments

The redesign lives or dies here. These recur across every job above — design them as
first-class, not afterthoughts.

- **Empty / first-run.** A brand-new account has **no dishes** — and an empty collection breaks
  the decide-tonight ritual, the browse list, and the plan all at once. This is arguably the
  most important screen in the app: it must make "add your first recipe" irresistible and point
  at the fast AI-ingest path. Design the zero-state of *every* job (empty plan, no pantry, no
  public dishes, never-cooked dish, no tags).
- **Loading / working — and especially the *long* waits.** Two operations take a genuinely long
  time and cannot be hidden behind a spinner: **AI recipe ingest (60–90s+)** and **AI photo
  generation (30–60s)**. These deserve honest, oriented, even pleasant working states that say
  what's happening and roughly how long it's been. The cook should never wonder if it's stuck.
- **Error / degraded.** Be specific and recoverable: ingest failed (show the error, allow a
  raw-output peek, offer retry); image generation refused or unconfigured; Todoist not
  configured or wrong project (name the fix); offline. Several network writes today fail
  *silently* (favorite, plan sync) — the redesign is free to surface these more honestly.
- **Sparse or uneven data.** Real collections are messy. Dishes with no photo (always a
  dignified placeholder), no subtitle, no tags, no method, never cooked, a 30-ingredient list,
  a dish with 12+ tags, a cook with one dish or two hundred. Every layout must stay graceful
  across this unevenness — don't design only for the rich, photogenic dish.
- **The pivotal "needs-you" moments.** These are where the app hands control back to the
  person, and they deserve special care:
  - The **decision + its reason** — the suggested dish and the plain-language "why this one"
    (§5.1). The trust moment.
  - **Reviewing the AI's work** — the parsed dish the cook confirms or corrects (§5.5).
  - **"You're actually out of a staple"** — bumping a pantry item onto this trip's list (§5.8).
  - **The one-time handle rename** — a warned, irreversible-ish action (§5.9).
  - **"Save the dish before you can generate a photo"** — a small gate that must be explained,
    not just disabled (§5.6).

---

## 7. Hard constraints (the only ones)

- **Web, mobile-first, installable PWA.** Phone leads; desktop is a deliberate secondary
  adaptation. Must feel native when installed: edge-to-edge under notch/home-indicator, an
  immersive full-screen cook mode, a home-screen icon, an offline fallback.
- **Multi-user with real auth.** This is *not* a single private app — it has accounts, Google +
  email/password sign-in, an allowlist-gated sign-up, and per-user data isolation. So
  onboarding, sign-in/up, and an account/settings surface **must exist**. The *non-goals* that
  follow: **no billing, no ads, no marketing site, no SEO** (public pages are intentionally
  noindex).
- **A public share layer that reads as standalone.** Public dish and profile pages are reachable
  with no account and must present as clean, self-contained shared pages (no app nav), while the
  same URLs give the owner full controls.
- **Light and dark are both real.** Theme (System/Light/Dark) is a first-class feature applied
  with no flash-of-wrong-theme; design both modes deliberately.
- **Legibility under density.** Ingredient lists, multi-unit shopping lines, and the week-plan
  carry a lot of precise information. It must stay scannable and unambiguous — quantities,
  units, and what's-excluded-and-why can't blur together.
- **Holds up with real, uneven content.** See §6 — the design must survive missing photos,
  long lists, sparse metadata, and wildly different collection sizes.

---

## 8. Explicitly free — your creative latitude

Everything below is **yours to decide.** Treat the current app as coverage reference only.

- **Information architecture & navigation** — how the app is organized and moved through. The
  current tab-bar-with-a-center-add is *not* sacred; invent your own structure.
- **The discovery mechanic** — the wheel/spin is explicitly *not* required (see §How-to-read #2).
  Reinvent how "decide what to cook" works, keeping only the bias and the transparency.
- **Layout & composition** at every breakpoint, and how desktop differs from phone.
- **Color & light/dark treatment**, **typography**, **components**, **density**,
  **iconography**, **motion/animation**, and **data-visualization** choices (how a shopping
  list, a week plan, cook history, or a decision-reason are visually expressed).
- **Exact copy** — all words on screen are yours to rewrite (clearer, warmer, or terser per
  §3); the brief fixes *meaning*, not wording.
- **Brand expression** — the name "Dinner Spinner" stays, but its mark, voice, and identity are
  yours to define.

**The only things sacred:** every **job in §5** stays possible, every capability in the
**appendix** stays possible, the §4 mental model stays **legible**, and the result **feels like
§3.** Within that, go as far as you like.

---

## Appendix — Full capability checklist (coverage guarantee)

Every capability the product provides today, as a literal coverage contract. The redesign must
keep all of these **possible**; *how and where* is entirely your call. This is a checklist, not
a screen map — grouping is by function, not by current page.

### A. Decide what to cook (discovery)

- [ ] Get a single suggested dish to cook, drawn from the collection
- [ ] Have the suggestion biased toward favorited dishes, away from recently-cooked ones, up by high ratings and down by low ratings — with no dish ever fully impossible
- [ ] Narrow the candidate set by one or more tags before deciding (AND semantics)
- [ ] See how large the candidate pool is and whether/how it's narrowed
- [ ] Read a plain-language reason for *why this dish* (pool + each factor and its effect)
- [ ] Re-decide / try again instantly
- [ ] Open the suggested dish's recipe
- [ ] Dismiss the suggestion and return to a neutral state
- [ ] Have chosen discovery filters remembered across visits
- [ ] (Today: spinner tag strip caps at 12 tags — a redesign may expose all tags or rethink this)

### B. Browse & find dishes (library)

- [ ] Browse the entire collection
- [ ] Per dish see: photo/placeholder, title, subtitle, tags (with overflow indication), last-cooked relative time (incl. "never cooked"), favorite state, in-plan state
- [ ] Search dishes by title/subtitle text (live)
- [ ] Filter by one or more tags (AND)
- [ ] Filter by diet (vegetarian / vegan / no dairy / no gluten / no nuts), derived live from ingredients
- [ ] Filter to favorites only
- [ ] See active filters and a count of matches; remove one filter or clear all
- [ ] See a live "show N dishes" count before applying a filter set
- [ ] Toggle a dish's favorite inline
- [ ] Add/remove a dish to the meal plan inline (at its base servings)
- [ ] See how many dishes are in the plan and jump to it
- [ ] Open any dish
- [ ] (Today: alphabetical order with no sort control, and distinct phone vs desktop card layouts — both free to rethink)

### C. View, scale & read a recipe

- [ ] See dish hero photo or a dignified placeholder (emoji/accent today)
- [ ] See title, optional subtitle, tags
- [ ] See derived diet/allergen chips (vegetarian/vegan + "contains …") with positive vs heads-up tone
- [ ] Step servings up/down and see every quantity rescale live
- [ ] See base servings for reference and reset to it
- [ ] Have the chosen servings remembered per dish
- [ ] See each ingredient's scaled quantity, unit, descriptor, name, alternatives ("or X")
- [ ] See pantry items de-emphasized/badged; fixed (non-scaling) items badged; optional items marked
- [ ] See ingredients grouped by recipe section when sections exist, flat otherwise
- [ ] See an empty-state when a dish has no ingredients
- [ ] Read the method as per-section numbered steps with inline emphasis; omit when no method
- [ ] (Owner) favorite, open cook mode at current servings, add to plan at current servings, jump to edit
- [ ] (Owner) see a pinned durable notes panel; see last-cooked and average rating/count
- [ ] (Visitor) see a clean read-only page with attribution linking to the cook's public profile
- [ ] Reach a public dish anonymously by link; be unable to see a private dish you don't own (it doesn't exist to you)
- [ ] Public/shared pages are noindex

### D. Cook mode (guided cooking)

- [ ] Enter an immersive, full-screen, nav-free cook mode (owner only) at a chosen serving count
- [ ] Adjust servings during cooking; all scalable ingredients rescale live; fixed ones stay put
- [ ] See a persistent scaled ingredient reference (grouped by section; pantry de-emphasized; optional marked)
- [ ] Read method steps (per-section numbering); tap a step to mark it done / undo
- [ ] Tap an ingredient mention in a step to locate and flash-highlight the exact ingredient(s)
- [ ] Benefit from precise ingredient-to-step links, gracefully degrading to name-matching when absent
- [ ] Tap a duration in a step to start a real countdown timer for that length
- [ ] Run multiple concurrent timers, each labeled with live remaining time
- [ ] Get an audible + visual alarm when a timer finishes; dismiss it
- [ ] Keep the screen awake while cooking (best-effort), with a status hint; re-acquire on refocus
- [ ] Exit cleanly back to the dish
- [ ] Handle no-parseable-method, no precise links, backgrounded-tab timers, blocked audio, unsupported wake-lock gracefully

### E. Capture a recipe — AI ingest

- [ ] Enter free-text (recipe prose, a URL, or a description) and/or attach one photo (camera or library)
- [ ] See a photo preview; remove it before submitting; submit with text, photo, or both
- [ ] Have the photo compressed client-side before upload
- [ ] See a full-screen working state with a specific, changing step label and an elapsed-time sense
- [ ] Have the parsed dish auto-saved and land on the finished dish page
- [ ] Have the app briefly wait for the generated photo, then proceed anyway if slow
- [ ] Be warned before navigating away mid-job; auto-resume an interrupted ingest on return (short window)
- [ ] See a clear error with optional raw-output peek and retry; recover from expired/long-running/invalid jobs
- [ ] Have recipes written in the user's chosen language while ingredient names stay English
- [ ] Have pantry staples auto-flagged; fixed and optional items auto-detected; multi-part recipes sectioned
- [ ] Have the parse re-validated for correctness before it's kept

### F. Author / edit a dish manually

- [ ] Create from blank or edit an existing dish in the same form; edit an auto-saved AI ingest afterward when needed
- [ ] Set title (required), subtitle, tags (with suggestions), base servings (default 4)
- [ ] Set a photo by URL or by AI generation; edit the image-description prompt; set emoji & accent
- [ ] Toggle favorite and public (default public, with a private = only-you explanation)
- [ ] Add/remove/reorder ingredient rows (drag handle and up/down)
- [ ] Per ingredient edit: quantity, unit, descriptor, name, preparation, section, alternatives
- [ ] Use autocomplete for units and ingredient names; have pantry auto-flag on known names
- [ ] Toggle each ingredient's pantry / fixed / optional flags
- [ ] Pin newly-flagged pantry names into the curated pantry list (single or bulk)
- [ ] Write the method as markdown steps; write a durable notes scratch-pad
- [ ] Save (create or update) with clear state and post-save feedback; cancel an edit
- [ ] Have blank ingredient rows dropped silently; have the title requirement enforced before save
- [ ] Be gated from generating a photo until the dish is saved (with an explanation)
- [ ] Delete a dish from a danger zone behind a confirmation
- [ ] Switch between AI-ingest and manual authoring

### G. Dish photos

- [ ] Trigger async AI photo (re)generation for an owned dish and watch for the result
- [ ] See a working state, success (preview updates), and clear failures (refusal / not configured / slow)
- [ ] Paste/edit an arbitrary image URL with a live preview
- [ ] Edit the image-description prompt (not shown publicly)
- [ ] Have newly-created dishes auto-receive a photo in the background
- [ ] Have generated photos follow a consistent house style so a collection looks cohesive
- [ ] Bulk-backfill photos for dishes missing one; bulk-regenerate all; recompress existing images
- [ ] See per-dish failures in bulk operations without losing the whole run
- [ ] Never be able to touch another user's photos

### H. Cooking history & memory

- [ ] Log "I cooked this" with an optional 1–5★ rating and an optional note (date-only allowed)
- [ ] See the new log reflected immediately in history and the dish's stats
- [ ] View cook history (date, relative time, rating, note), newest first
- [ ] See a dish's last-cooked, average rating, and rating count
- [ ] Favorite/unfavorite a dish
- [ ] Keep a durable per-dish notes scratch-pad, distinct from per-cook notes
- [ ] (Cook entries are append-only and time-stamped at save — no edit/backdate today)

### I. Plan the week & shopping list

- [ ] See all planned dishes, each with thumbnail, title, link, and a serving count
- [ ] Arrange dishes across 7 weekday columns plus an unassigned pool; see per-column counts
- [ ] Move a dish to a day or back to the pool; reset all day assignments; clear the whole plan
- [ ] Set per-dish servings (independent of base servings)
- [ ] Remove a dish from the plan
- [ ] See a consolidated shopping list across all planned dishes (pool dishes included)
- [ ] Have quantities scaled per entry, then merged within unit category (weights via g, volumes via ml)
- [ ] See multi-unit items of one ingredient grouped sensibly rather than wrongly summed
- [ ] Have pantry staples excluded and shown separately as a "pantry check" with a count
- [ ] Toggle inclusion of optional ingredients (affects both list and pantry check)
- [ ] Mark a pantry staple out-of-stock to add it to this trip's list, and undo
- [ ] Push the list to Todoist as individual tasks; see how many were created or a specific error
- [ ] Have the plan persist locally and sync per-user across devices; degrade to local-only offline
- [ ] See that preparation detail is intentionally dropped from shopping/Todoist text
- [ ] Empty-plan, nothing-to-buy, no-pantry, nothing-slotted, and Todoist-not-configured states

### J. Public profile, sharing & identity

- [ ] Have a public profile at a unique handle with display name, avatar (or placeholder), and bio
- [ ] (Owner) see all your dishes incl. private (badged), ordered favorites-first then recency
- [ ] (Visitor) see only public dishes, ordered favorites-first then newest
- [ ] Owner vs visitor empty-state copy; unknown-handle doesn't-exist
- [ ] (Owner) reach settings from the profile; edit handle (once, with a break-links warning) and bio (counted)
- [ ] Control each dish's public/private state
- [ ] Anonymous visitors get a standalone page with no app chrome
- [ ] Reach your owner-home, see your public URL stated, and a "Friends — coming soon" placeholder

### K. Get in & install (auth / onboarding / PWA)

- [ ] Sign in with Google or with email + password
- [ ] Sign up (allowlist-gated) and be auto-signed-in; fall back to manual if that fails
- [ ] Be returned to your intended destination after sign-in
- [ ] See a deliberately vague credentials error that doesn't reveal which detail was wrong
- [ ] Be auto-assigned a valid unique handle on account creation
- [ ] Install to the home screen — native one-tap on Android, manual instructions on iOS
- [ ] Not be nagged again once dismissed or already installed
- [ ] See an offline fallback explaining new dishes need a connection while recent ones still work, with links back

### L. Account, data & settings

- [ ] See your signed-in email, name, and avatar; sign out
- [ ] Choose theme (System / Light / Dark) and see what "System" currently resolves to
- [ ] Choose recipe language (English / Dutch / German / French / Spanish / Italian) with instant feedback
- [ ] Change password (only when the account has one), with precise errors
- [ ] Configure your own Todoist token (write-only/masked) + project; clear it (confirmed)
- [ ] Curate a pantry list (add with autocomplete / remove via chip); understand it's exact-match exclusion
- [ ] Export a dated JSON backup of dishes + pantry + meal plan
- [ ] Import a backup (confirmed, validated) and see exactly what was imported; understand merge vs replace semantics

### M. App shell, navigation & cross-cutting

- [ ] Move between all core areas from persistent navigation; reach "add a recipe" quickly from anywhere
- [ ] See a live badge of how many dishes are queued in the plan
- [ ] Hide app chrome for anonymous share-link visitors and for immersive cook mode
- [ ] A consistent header with home/brand vs back behavior and room for per-page controls
- [ ] Theme applied before first paint (no flash); follows OS live while on System; legacy preference migrated
- [ ] Every dish always representable by a thumbnail (photo, else emoji-on-accent placeholder)
- [ ] Transient toast confirmations; a consistent icon set that recolors with the theme
- [ ] Edge-to-edge native feel respecting device safe-areas

---

*Coverage note: this brief was built from a full read of the live application — every route,
mutation, weighting rule, diet heuristic, async pipeline, and auth carve-out — cross-checked
by a completeness pass. A handful of present-day implementation quirks (a 12-tag spinner cap,
alphabetical-only library sort, append-only cook log, dual responsive library cards, bulk-image
ceilings) are noted inline as **coverage facts, not constraints** — the redesign is free to keep,
change, or improve any of them, as long as the underlying job stays possible.*
