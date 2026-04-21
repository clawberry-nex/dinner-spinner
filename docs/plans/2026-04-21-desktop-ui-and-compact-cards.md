# Desktop UI rework + compact dish cards — implementation plan

**Roadmap item.** `sXYCS68AqnMo` — "Fix the horrible UI on desktop and other UI changes".

## Problem summary

The app is a mobile-first PWA but also lives on the web at
`dinner-spinner-lake.vercel.app`, so desktop users see:

1. **A 440-pixel column on a 2560-pixel monitor.** `app/_components/app-shell.tsx`
   forces every route into `max-w-[440px] md:max-w-2xl lg:max-w-3xl`. On a
   laptop/desktop that's a tall, narrow strip of content with huge empty
   margins left and right.
2. **A bottom tab bar that does not stretch across the viewport.** Because
   the tab bar is rendered *inside* the constrained shell, it inherits the
   narrow column — four tiny tab buttons floating over a sea of background.
3. **Dish cards eat the whole screen.** Each `/dishes` card has a
   full-width hero image (16:10 aspect ratio), oversized title, subtitle,
   two action buttons, tag row, timestamp. One card is roughly a full
   mobile viewport, so browsing is slow.

## Design decisions (made autonomously, no user input)

1. **Decouple shell chrome from content width.** The outer shell fills
   the viewport (`w-full`), the tab bar stretches edge-to-edge, but an
   inner `max-w` cap keeps long text lines readable. The bar's tab
   buttons are centered inside the bar via a `max-w-2xl mx-auto` inner
   row so on a huge monitor the buttons stay grouped instead of drifting
   apart.
2. **Per-page container, not per-shell.** Each route wraps its scrollable
   content in a local container with a sensible responsive max-width
   (spinner: `max-w-3xl`, dishes: `max-w-6xl`, plan: `max-w-6xl`,
   admin: `max-w-3xl`). This is simpler than a global wrapper because
   pages already have their own inner padding and scroll containers, and
   a single global max-width would either cramp the dishes grid or
   over-stretch text-heavy pages.
3. **Compact dish cards on mobile, grid on desktop.**
   * `< md` (≤ 767px): horizontal list card — 72×72 square thumbnail on
     the left, title/subtitle/tags on the right, favourite star and
     "add to plan" pill stacked vertically on the right edge. Removes
     the full-width hero and cuts each row to roughly one-third its
     current height.
   * `md` (≥ 768px): 2-column grid of cards with capped hero image
     (~160px height).
   * `xl` (≥ 1280px): 3-column grid.
   * `2xl` (≥ 1536px): 4-column grid.
4. **AppHeader also stretches.** The header is already part of the
   constrained shell; when the shell goes full-width the header needs
   an inner `max-w` too, otherwise the brand mark + title drift to the
   far left of a 4K screen. Use the same pattern: outer `w-full`, inner
   `mx-auto max-w-6xl` for the content.
5. **Scope discipline.** Touch only: shell, tab bar, header, and each
   page's outer layout div + the dishes card render. Don't redesign the
   spinner wheel, dish-detail layout, cook mode, admin form internals,
   or plan columns — those are already responsive and look fine once the
   container widens. The admin login page and offline page are already
   stand-alone centered; leave them.
6. **No new components for width management.** Just apply the utility
   classes inline at each page root. A shared `<Container>` wrapper
   would be over-engineering for 4 routes.
7. **Existing `md:grid-cols-2` stays valid.** Tailwind's `md:` prefix
   means ≥768px — on a desktop that's tight. Upgrade the grid on
   `/dishes` to the 1/2/3/4 progression above so the existing 2-column
   turn-on at 768px still happens (tablet-friendly) but scales up.
8. **Keep the mobile single-column portrait exactly as it is at the
   narrowest widths.** The PWA on a phone is the primary target. The
   new desktop layout must be an *addition*, not a replacement.
9. **No tests for pure layout/Tailwind class changes.** These are
   CSS-only and verifying them with unit tests would be a net loss
   (tests would assert class strings, which drift every time a utility
   name changes). Keep TDD for logic; rely on visual/manual verification
   (dev server, multiple viewport sizes) for the layout.

## Concrete edits

### `app/_components/app-shell.tsx`
Change the outer div from the constrained column to a full-width shell:
```diff
- <div className="mx-auto flex h-[100dvh] max-w-[440px] flex-col overflow-hidden bg-bg md:max-w-2xl lg:max-w-3xl">
+ <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-bg">
```
Keep the flex column + the inner scrollable child + the tab bar.

### `app/_components/tab-bar.tsx`
1. Keep the sticky bottom bar full-width (`w-full`).
2. Wrap the four tab links in an inner `max-w-2xl mx-auto w-full` row so
   the icons stay grouped on wide screens.
3. On narrow (< sm) the row still fills 100% (flex-1 per tab).

### `app/_components/app-header.tsx`
Wrap the existing header content in an inner `mx-auto w-full max-w-6xl`
div so the brand mark aligns with the page content on wide screens.
The outer element keeps `border-b` and `bg-bg` so the visual divider
spans the whole viewport.

### `app/page.tsx` (spinner)
Add a `mx-auto w-full max-w-3xl` wrapper around the scrollable inner
content so the hero text and wheel sit in a comfortable desktop column
but don't balloon to 2560px wide.

### `app/dishes/page.tsx`
1. Outer page container: `mx-auto w-full max-w-6xl` on the scrollable
   content div.
2. Filter bar: keep as-is (already full-width inside the container).
3. Bottom sheet: widen caps to match (`md:max-w-2xl lg:max-w-3xl`
   stays — it's a modal, not the page).
4. **Card grid:** change `grid-cols-1 md:grid-cols-2` →
   `grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4`.
5. **Card layout:** split the `<li>` into two visual branches via
   Tailwind responsive utilities:
   * `< md`: flex-row card. Thumbnail 72×72 on the left (use
     `DishArt size={72}`), text block flex-1 in the middle,
     star + add-to-plan stacked vertically on the right.
     Tag row + "last cooked" sit below title within the text block.
   * `md+`: original layout — hero image on top, text below.
   Implement as two siblings inside the `<li>` wrapped in
   `md:hidden` / `hidden md:block` classes. Yes that duplicates JSX
   but it's the least-risky approach for responsive layout with this
   much conditional chrome (image + actions + metadata).

### `app/plan/page.tsx`
Add `mx-auto w-full max-w-6xl` wrapper around the inner scrollable
content div. The existing day grid already goes to `xl:grid-cols-7` so
it'll look right once the container can use the width.

### `app/dishes/[id]/page.tsx` & `dish-view.tsx`
Add `mx-auto w-full max-w-3xl` wrapper around the inner scrollable
content in `dish-view.tsx` so the recipe column stays readable on
desktop rather than spanning the full screen.

### `app/admin/page.tsx`
Add `mx-auto w-full max-w-3xl` wrapper so the admin form doesn't
stretch to 4K width. Admin is a long vertical form; keeping it column-ish
matches the edit experience.

## Verification (manual)

1. `npm run dev` — load the app.
2. Check Spinner, Dishes, Plan, a Dish detail, Admin at:
   * 390×844 (iPhone 14 portrait)
   * 768×1024 (iPad portrait)
   * 1440×900 (MacBook)
   * 2560×1440 (external monitor)
3. Confirm: tab bar stretches edge-to-edge on all sizes; content stays
   readable; dish cards switch from list → grid at ~768px and fit 2/3/4
   across at 768/1280/1536.
4. `npm run build` must still succeed.
5. Run node:test suite — still passes (no test changes).

## Rollout

1. Feature branch: `feat/desktop-ui`.
2. One commit per logical step (shell / tab bar / header / dishes / others).
3. Merge to `main`, bump package.json to `0.12.0`, update README/CHANGELOG
   if present, push.
4. Vercel auto-deploys on push to `main`.
5. Mark roadmap item `sXYCS68AqnMo` shipped at `v0.12.0`.
