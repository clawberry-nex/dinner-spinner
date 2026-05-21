import { z } from "zod";
import { sql } from "@/lib/db";
import { IngredientSchema } from "@/lib/types";
import { resolveUserId } from "@/lib/auth-helpers";
import { createShoppingTasks, createTaskContents } from "@/lib/todoist";

// Accept either {ingredients: Ingredient[]} (legacy; server formats each
// ingredient into a task) or {tasks: string[]} (pre-formatted content,
// used by the plan page to group multi-unit items into one line).
const BodySchema = z.union([
  z.object({ ingredients: z.array(IngredientSchema).min(1) }),
  z.object({ tasks: z.array(z.string().trim().min(1)).min(1) }),
]);

export async function POST(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Resolve Todoist credentials: per-user override first, env fallback
  // only for the seed owner.
  const userRows = await sql`
    SELECT email, todoist_token, todoist_project FROM users WHERE id = ${userId}
  `;
  const user = userRows[0];
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let token = (user.todoist_token as string | null) ?? null;
  let projectName = (user.todoist_project as string | null) ?? null;
  const seedEmail = (process.env.SEED_OWNER_EMAIL ?? "").trim().toLowerCase();
  if ((!token || !projectName) && user.email === seedEmail) {
    token ??= process.env.TODOIST_API_TOKEN ?? null;
    projectName ??= process.env.TODOIST_PROJECT_NAME ?? null;
  }
  if (!token || !projectName) {
    return Response.json({ error: "todoist_not_configured" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const count =
      "tasks" in parsed.data
        ? await createTaskContents({
            token,
            projectName,
            contents: parsed.data.tasks,
          })
        : await createShoppingTasks({
            token,
            projectName,
            ingredients: parsed.data.ingredients,
          });
    return Response.json({ ok: true, created: count });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Todoist error" },
      { status: 502 },
    );
  }
}
