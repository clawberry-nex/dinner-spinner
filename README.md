# Dinner Spinner

Personal web app: spin a button to pick a random dish, scale servings, build a
multi-dish shopping list, and push it to Todoist. Admin UI and a tokened POST
endpoint for adding new dishes.

Next.js 16 (App Router) + TypeScript + Tailwind v4 + Postgres on Neon. Deploys
to Vercel — auto-deploys from `main`.

- **Production**: https://dinner-spinner-lake.vercel.app
- **Admin**: https://dinner-spinner-lake.vercel.app/admin

The earlier MongoDB-based attempt lives (archived, read-only) at
[clawberry-nex/dinner-spinner-old](https://github.com/clawberry-nex/dinner-spinner-old).

## Environment variables

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string (required) |
| `ADMIN_PASSWORD` | Password for the `/admin` UI |
| `SESSION_SECRET` | HMAC key for the admin session cookie (≥16 chars) |
| `API_TOKEN` | Bearer token accepted by `POST /api/dishes` |
| `TODOIST_API_TOKEN` | Todoist REST API token |
| `TODOIST_PROJECT_NAME` | Name of the Todoist project that shopping tasks go into |

See `.env.example`.

## Local setup

```bash
npm install
cp .env.example .env.local   # then fill in values
psql "$DATABASE_URL" -f db/schema.sql
npm run dev
```

## Adding a dish via the API

```bash
curl -X POST https://<your-deploy>/api/dishes \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "title": "Vegetarian Lasagna",
    "subtitle": "Layered comfort",
    "tags": ["vegetarian", "Finn likes this"],
    "baseServings": 4,
    "ingredients": [
      { "quantity": 2, "unit": "pcs", "name": "carrot" },
      { "quantity": 400, "unit": "g", "name": "lasagna sheets" }
    ],
    "recipe": "1. Preheat oven...\n2. ..."
  }'
```

## Routes

- `/` — spinner (client-side filter by tags, press Spin, routes to detail)
- `/dishes/[id]` — dish detail with servings stepper, add to meal plan
- `/plan` — meal plan, aggregated shopping list, send to Todoist
- `/admin` — password-protected dish management
- `/admin/login` — login form
- `POST /api/dishes` — create dish (bearer token or admin cookie)
- `PATCH|DELETE /api/dishes/[id]` — update/delete (admin cookie only via UI)
- `GET /api/dishes` — list dishes (optional `?tags=a,b` filter)
- `GET /api/tags` — list distinct tags
- `POST /api/todoist` — push aggregated shopping list to Todoist

## Deploying

1. `gh repo create clawberry-nex/dinner-spinner --public --source=. --push`
2. In the Vercel dashboard, import the GitHub repo (or use `vercel link`).
3. Add all env vars from the table above in the Vercel project settings.
4. After the first deploy, apply the schema once:
   `psql "$DATABASE_URL" -f db/schema.sql`.

## Ingredient aggregation

Ingredients are grouped by `(name, unit)` case-insensitively and summed.
Mismatched units (e.g. `100 g flour` vs `1 cup flour`) are listed separately
— there's no unit conversion.

The recipe's `baseServings` is the source of truth for scaling: when you view
a dish at N servings, each quantity is multiplied by `N / baseServings`.
