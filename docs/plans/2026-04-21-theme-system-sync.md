# Sync dark/light theme with system

Roadmap id `rNCgZpGyjhbQ`. Complexity: xs.

## Problem

Current theme (app/_components/theme-provider.tsx) starts from
`prefers-color-scheme` **only on first visit**. Any click on the header
toggle writes `ds_dark` to localStorage (`"0"` / `"1"`) and from then on
the app ignores the system setting. It also does **not** listen for live
changes — toggling the OS between light and dark while the page is open
has no effect.

## Desired behaviour

- Default state: follow the system (no stored preference).
- While on "system", live-sync with the OS: switching appearance flips
  the app immediately.
- A user can still lock a specific mode (Light or Dark) from the header.
- Tri-state cycle in the header button: **System → Light → Dark → System**.
  - Icon: `auto` (or similar) when on system; `moon` in dark; `sun` in
    light. Tooltip names the *next* state: "Switch to light", etc.
- Reuse the same initial-render inline script strategy to avoid FOUC.

## Design

### Storage

- New key `ds_theme` with values `"system" | "light" | "dark"`. `null` =
  system.
- **Migration:** if legacy `ds_dark` is present and `ds_theme` is absent,
  read `ds_dark`: `"1"` → `"dark"`, `"0"` → `"light"`. Write the new
  key and delete the old. Users who had locked a preference keep it.

### Pure helpers (`lib/theme.ts`, unit-tested)

```ts
type ThemeSetting = "system" | "light" | "dark";
type EffectiveMode = "light" | "dark";

readThemeSetting(storage): ThemeSetting          // handles migration
writeThemeSetting(storage, setting): void        // removes key on "system"
resolveEffective(setting, systemPrefersDark): EffectiveMode
nextSetting(current: ThemeSetting): ThemeSetting // system→light→dark→system
```

Tests live in `lib/theme.test.ts` and are runnable with
`node --test --experimental-strip-types lib/theme.test.ts`.

### Client changes

- `theme-provider.tsx` becomes a thin shell around `lib/theme.ts`:
  - State: `setting: ThemeSetting`, `effective: EffectiveMode`.
  - On mount: seed both from `<html data-mode>` and `ds_theme`.
  - Subscribe to `matchMedia('(prefers-color-scheme: dark)')` changes;
    when `setting === "system"`, recompute `effective` and update
    `data-mode` attribute. Unsubscribe on unmount.
  - `cycle()` advances setting, persists, and updates `data-mode`.
  - Exposes `{ setting, effective, cycle }`.
- `app-header.tsx`:
  - Replaces `toggleDark` / `dark` with the new API.
  - Icon picks: `auto` (system) / `sun` (light) / `moon` (dark). The
    icon set (`Icon`) has `sun` and `moon`; add a `laptop`-style glyph
    for system (or reuse existing if present).
  - `aria-label` describes current + next state.

### Inline boot script (`themeScript`)

Runs before first paint to set `data-mode`:

```js
(function(){try{
  var s = localStorage.getItem('ds_theme');
  if (s == null) {
    // migrate legacy ds_dark
    var old = localStorage.getItem('ds_dark');
    if (old === '1') { s = 'dark'; localStorage.setItem('ds_theme', s); localStorage.removeItem('ds_dark'); }
    else if (old === '0') { s = 'light'; localStorage.setItem('ds_theme', s); localStorage.removeItem('ds_dark'); }
  }
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var dark = s === 'dark' || (s !== 'light' && prefersDark);
  document.documentElement.setAttribute('data-mode', dark ? 'dark' : 'light');
}catch(e){}})();
```

Kept tiny, no templating; mirrors `resolveEffective` logic exactly.

## TDD order

1. Add `lib/theme.test.ts` covering:
   - `readThemeSetting`: no key → "system"; legacy `ds_dark=1` → "dark"
     with migration side-effects; legacy `ds_dark=0` → "light" with
     migration; garbage value → "system".
   - `writeThemeSetting`: "system" removes key, "light"/"dark" write it.
   - `resolveEffective`: truth table (system+dark, system+light,
     explicit light, explicit dark).
   - `nextSetting`: system→light→dark→system.
2. Implement `lib/theme.ts` to go green.
3. Refactor `theme-provider.tsx` and `app-header.tsx`. No tests for
   the React layer — it's thin glue and will be exercised by manual
   Playwright check.
4. Run full unit test suite, `next build`, and eyeball the dev server
   once.

## Ship

- Feature branch `feat/theme-system-sync`.
- Merge to main, bump to `0.12.1` (patch — no behavior regression, just
  a UX improvement), `next build`, push.
- No CHANGELOG file in repo. Commit/PR messages document the change.
- Mark roadmap `rNCgZpGyjhbQ` shipped with `0.12.1`.

## Decisions & trade-offs

- **Cycle vs. picker menu:** A menu would be more obvious, but the
  header is dense and the existing affordance is a single round button.
  A 3-state cycle keeps the same footprint. The tooltip compensates
  for discoverability.
- **Migration:** We move `ds_dark` → `ds_theme` rather than keeping both
  so there's a single source of truth going forward.
- **Live listening only while setting === "system":** keeps the mental
  model simple — "system" means *follow*, "light"/"dark" mean *lock*.
  We don't re-seed when the user picks a mode that happens to match
  the OS; they've expressed a preference, we honour it.
