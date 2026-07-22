# Dinner Spinner

A private-first recipe app for choosing dinner, scaling servings, planning
meals, building a consolidated shopping list, and sending it to Todoist.
Recipes can be entered manually or imported from text, photos, URLs, and batch
documents with Nex-backed structuring and image generation.

Production: [dinner-spinner.van-willigenburg.nl](https://dinner-spinner.van-willigenburg.nl)

## What it supports

- NextAuth v5 sign-in with Google or email/password; new accounts are gated by
  `ALLOWED_EMAILS`.
- Strict per-user data isolation, plus explicitly public profiles and recipes
  that can be shared without signing in.
- Structured ingredient quantities, unit-aware shopping-list aggregation,
  pantry defaults, optional ingredients, serving scaling, and cook history.
- Async single-recipe and resumable batch imports through the Nex API.
- Vercel Blob-backed recipe photos and premium/non-premium image model gating.
- A fully implemented read-only `/demo` experience that stays dormant (404)
  until a reviewed static recipe snapshot is committed.

## Stack

Next.js 16 App Router, TypeScript, React 19, Tailwind CSS 4, Neon Postgres,
NextAuth v5, Zod, and Vercel Blob. The app uses npm and intentionally has no
ORM or migration framework.

## Local development

```bash
npm install --include=dev
cp .env.example .env.local
npm run dev
```

Fill the required values in `.env.local`. `npm install --include=dev` matters
on this machine because agent shells can inherit `NODE_ENV=production`, which
otherwise skips the development toolchain. Apply `db/schema.sql` manually when
setting up a new database or after an additive schema change.

Useful checks:

```bash
npx next typegen
npx tsc --noEmit
npm run lint
npm run build
```

The repo-wide lint and direct unit-test commands have documented existing
failure baselines; see the Verification section in `AGENTS.md` before
interpreting their results.

## Documentation

- [`AGENTS.md`](AGENTS.md) — authoritative architecture, data contracts,
  operational traps, environment variables, and verification commands.
- [`docs/adr/0001-inline-ingredient-references.md`](docs/adr/0001-inline-ingredient-references.md)
  — cook-mode ingredient-reference decision.
- [`docs/operations/ingest-debugging.md`](docs/operations/ingest-debugging.md)
  — recover and validate a failed ingest payload.
- [`docs/superpowers/specs/2026-06-26-demo-read-only-design.md`](docs/superpowers/specs/2026-06-26-demo-read-only-design.md)
  — dormant public demo design and data boundary.

`CLAUDE.md` is only the Claude Code adapter and imports `AGENTS.md`; shared
project guidance belongs in `AGENTS.md`, not in harness-specific memory.
