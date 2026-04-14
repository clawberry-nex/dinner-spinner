import type { Ingredient } from "./types";
import { formatIngredient } from "./ingredients";

// Pinned to /api/v1 — the old /rest/v2 was deprecated and returns 410.
// Projects response is {results, next_cursor}, so pagination is handled below.
const API = "https://api.todoist.com/api/v1";

async function todoistFetch(path: string, init: RequestInit = {}) {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) throw new Error("TODOIST_API_TOKEN is not set");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Todoist ${init.method ?? "GET"} ${path} → ${res.status}: ${body}`);
  }
  return res;
}

type TodoistProject = { id: string; name: string };
type TodoistProjectsResponse = {
  results: TodoistProject[];
  next_cursor: string | null;
};

async function resolveProjectId(name: string): Promise<string> {
  const projects: TodoistProject[] = [];
  let cursor: string | null = null;
  do {
    const path: string = cursor
      ? `/projects?cursor=${encodeURIComponent(cursor)}`
      : "/projects";
    const res = await todoistFetch(path);
    const data = (await res.json()) as TodoistProjectsResponse;
    projects.push(...data.results);
    cursor = data.next_cursor;
  } while (cursor);

  const match = projects.find(
    (p) => p.name.toLowerCase() === name.toLowerCase(),
  );
  if (!match) {
    throw new Error(
      `Todoist project "${name}" not found. Existing: ${projects.map((p) => p.name).join(", ")}`,
    );
  }
  return match.id;
}

export async function createShoppingTasks(ingredients: Ingredient[]): Promise<number> {
  return createTaskContents(ingredients.map(formatIngredient));
}

// Lower-level variant: takes already-formatted task content strings. Lets
// callers do grouping/formatting client-side (e.g. "2 can + 400 ml coconut
// milk" as one task).
export async function createTaskContents(contents: string[]): Promise<number> {
  const projectName = process.env.TODOIST_PROJECT_NAME;
  if (!projectName) throw new Error("TODOIST_PROJECT_NAME is not set");
  const projectId = await resolveProjectId(projectName);

  let created = 0;
  for (const content of contents) {
    await todoistFetch("/tasks", {
      method: "POST",
      body: JSON.stringify({ content, project_id: projectId }),
    });
    created += 1;
  }
  return created;
}
