import { cookies } from "next/headers";
import { z } from "zod";
import { IngredientSchema } from "@/lib/types";
import {
  ADMIN_COOKIE_NAME,
  checkApiToken,
  verifySessionCookieValue,
} from "@/lib/auth";
import { createShoppingTasks, createTaskContents } from "@/lib/todoist";

// Accept either {ingredients: Ingredient[]} (legacy; server formats each
// ingredient into a task) or {tasks: string[]} (pre-formatted content,
// used by the plan page to group multi-unit items into one line).
const BodySchema = z.union([
  z.object({ ingredients: z.array(IngredientSchema).min(1) }),
  z.object({ tasks: z.array(z.string().trim().min(1)).min(1) }),
]);

async function isAuthorized(request: Request): Promise<boolean> {
  if (checkApiToken(request.headers.get("authorization"))) return true;
  const jar = await cookies();
  return verifySessionCookieValue(jar.get(ADMIN_COOKIE_NAME)?.value);
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
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
        ? await createTaskContents(parsed.data.tasks)
        : await createShoppingTasks(parsed.data.ingredients);
    return Response.json({ ok: true, created: count });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Todoist error" },
      { status: 502 },
    );
  }
}
