import type { Ingredient } from "./types";
import { formatIngredient } from "./ingredients";

// Pinned to /api/v1 — the old /rest/v2 was deprecated and returns 410.
// Projects response is {results, next_cursor}, so pagination is handled below.
const API = "https://api.todoist.com/api/v1";

async function todoistFetch(token: string, path: string, init: RequestInit = {}) {
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

async function resolveProjectId(token: string, name: string): Promise<string> {
  const projects: TodoistProject[] = [];
  let cursor: string | null = null;
  do {
    const path: string = cursor
      ? `/projects?cursor=${encodeURIComponent(cursor)}`
      : "/projects";
    const res = await todoistFetch(token, path);
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

export type TodoistConfig = {
  token: string;
  projectName: string;
};

export async function createShoppingTasks(
  config: TodoistConfig & { ingredients: Ingredient[] },
): Promise<number> {
  return createTaskContents({
    token: config.token,
    projectName: config.projectName,
    contents: config.ingredients.map(formatIngredient),
  });
}

// Lower-level variant: takes already-formatted task content strings. Lets
// callers do grouping/formatting client-side (e.g. "2 can + 400 ml coconut
// milk" as one task).
export async function createTaskContents(
  config: TodoistConfig & { contents: string[] },
): Promise<number> {
  const projectId = await resolveProjectId(config.token, config.projectName);

  let created = 0;
  for (const content of config.contents) {
    await todoistFetch(config.token, "/tasks", {
      method: "POST",
      body: JSON.stringify({ content, project_id: projectId }),
    });
    created += 1;
  }
  return created;
}
