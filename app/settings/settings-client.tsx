"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { STANDARD_INGREDIENTS } from "@/lib/vocabulary";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";
import { useTheme } from "@/app/_components/theme-provider";
import { Icon, type IconName } from "@/app/_components/icon";
import type { ThemeSetting } from "@/lib/theme";

type Props = {
  user: {
    email: string;
    name: string | null;
    image: string | null;
    hasPassword: boolean;
    isSeedOwner: boolean;
  };
};

export default function SettingsClient({ user }: Props) {
  const router = useRouter();
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [pantryDefaults, setPantryDefaults] = useState<string[]>([]);
  const [newPantryName, setNewPantryName] = useState("");

  // Language section.
  const [language, setLanguage] = useState<string | null>(null);
  const [languageMsg, setLanguageMsg] = useState<string | null>(null);

  // Todoist section.
  const [todoistHasToken, setTodoistHasToken] = useState(false);
  const [todoistProject, setTodoistProject] = useState<string | null>(null);
  const [todoistTokenInput, setTodoistTokenInput] = useState("");
  const [todoistProjectInput, setTodoistProjectInput] = useState("");
  const [todoistMsg, setTodoistMsg] = useState<string | null>(null);

  // Password section.
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  // Backup.
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const ingredientNameOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of [...STANDARD_INGREDIENTS, ...existingNames]) {
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [existingNames]);

  async function reload() {
    const [nRes, pRes, tRes, lRes] = await Promise.all([
      fetch("/api/ingredient-names"),
      fetch("/api/pantry-defaults"),
      fetch("/api/me/todoist"),
      fetch("/api/me/language"),
    ]);
    if (nRes.ok) setExistingNames((await nRes.json()) as string[]);
    if (pRes.ok) setPantryDefaults((await pRes.json()) as string[]);
    if (tRes.ok) {
      const td = (await tRes.json()) as {
        hasToken: boolean;
        projectName: string | null;
      };
      setTodoistHasToken(td.hasToken);
      setTodoistProject(td.projectName);
      setTodoistProjectInput(td.projectName ?? "");
    }
    if (lRes.ok) {
      const ld = (await lRes.json()) as { language: string | null };
      setLanguage(ld.language);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload().catch(() => {});
  }, []);

  async function saveTodoist(e: React.FormEvent) {
    e.preventDefault();
    setTodoistMsg(null);
    const token = todoistTokenInput.trim() || null;
    const projectName = todoistProjectInput.trim() || null;
    const res = await fetch("/api/me/todoist", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, projectName }),
    });
    if (res.ok) {
      setTodoistMsg("Saved.");
      setTodoistTokenInput("");
      await reload();
    } else {
      setTodoistMsg(`HTTP ${res.status}`);
    }
  }

  async function clearTodoist() {
    if (!confirm("Clear your Todoist token and project?")) return;
    setTodoistMsg(null);
    const res = await fetch("/api/me/todoist", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: null, projectName: null }),
    });
    if (res.ok) {
      setTodoistMsg("Cleared.");
      setTodoistTokenInput("");
      setTodoistProjectInput("");
      await reload();
    }
  }

  async function saveLanguage(value: string | null) {
    setLanguageMsg(null);
    const prev = language;
    setLanguage(value);
    const res = await fetch("/api/me/language", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: value }),
    });
    if (res.ok) {
      setLanguageMsg("Saved.");
    } else {
      setLanguage(prev); // revert optimistic change so UI matches server
      setLanguageMsg(`HTTP ${res.status}`);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    const res = await fetch("/api/me/password", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current: pwCurrent, next: pwNext }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok) {
      setPwMsg("Password changed.");
      setPwCurrent("");
      setPwNext("");
    } else {
      setPwMsg(messageForPwError(data.error));
    }
  }

  async function addPantryDefault(name: string) {
    const normalized = name.toLowerCase().trim();
    if (!normalized) return;
    const res = await fetch("/api/pantry-defaults", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: normalized }),
    });
    if (res.ok) {
      setPantryDefaults((prev) =>
        [...new Set([...prev, normalized])].sort((a, b) => a.localeCompare(b)),
      );
    }
  }

  async function removePantryDefault(name: string) {
    const res = await fetch(
      `/api/pantry-defaults?name=${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      setPantryDefaults((prev) => prev.filter((n) => n !== name));
    }
  }

  async function downloadBackup() {
    setBackupMsg(null);
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setBackupMsg(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().slice(0, 10);
      a.download = `dinner-spinner-backup-${today}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBackupMsg("Downloaded.");
    } catch (err) {
      setBackupMsg(err instanceof Error ? err.message : "Download failed");
    }
  }

  async function importBackup(file: File) {
    setBackupMsg(null);
    setImporting(true);
    try {
      const text = await file.text();
      try {
        JSON.parse(text);
      } catch {
        setBackupMsg("Not valid JSON");
        return;
      }
      if (!confirm("Import this backup into your account?")) return;
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        counts?: { dishes: number; pantryNames: number; mealPlanEntries: number };
      };
      if (!res.ok || !data.ok) {
        setBackupMsg(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setBackupMsg(
        `Imported ${data.counts?.dishes ?? 0} dishes, ` +
          `${data.counts?.pantryNames ?? 0} pantry names, ` +
          `${data.counts?.mealPlanEntries ?? 0} meal-plan entries.`,
      );
      reload();
    } finally {
      setImporting(false);
    }
  }

  const todoistFallbackHint =
    user.isSeedOwner && !todoistHasToken && !todoistProject
      ? "Currently using TODOIST_API_TOKEN / TODOIST_PROJECT_NAME env fallback."
      : null;

  return (
    <>
      {/* Header — eyebrow + serif title; mobile gets a back affordance since the
          shell sidebar is desktop-only. */}
      <div className="mb-7 flex items-start gap-3 lg:mt-2">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="mt-[2px] grid h-9 w-9 shrink-0 place-items-center rounded-pill border border-line bg-surface-2 text-text transition-colors hover:bg-surface-3 lg:hidden"
        >
          <Icon name="chevL" size={18} />
        </button>
        <div className="min-w-0">
          <div className="mb-[10px] text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
            Settings
          </div>
          <h1
            className="m-0 font-medium leading-[1.04] tracking-[-0.02em] text-text"
            style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(30px,6vw,42px)" }}
          >
            Your kitchen
          </h1>
        </div>
      </div>

      <div className="flex flex-col gap-7">
        {/* Profile */}
        <Section title="Profile">
          <div className="flex items-center gap-4">
            {user.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt=""
                className="h-12 w-12 rounded-full border border-line"
              />
            )}
            <div className="min-w-0 flex-1">
              {user.name && (
                <div className="font-medium text-text">{user.name}</div>
              )}
              <div className="truncate text-[13px] text-text-dim">{user.email}</div>
            </div>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
              className="inline-flex shrink-0 items-center gap-[6px] rounded-pill border border-line bg-surface-2 px-[14px] py-[8px] text-[13px] font-semibold text-text-dim transition-colors hover:border-line-2 hover:text-text"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              Sign out
            </button>
          </div>
        </Section>

        {/* Appearance — theme picker. */}
        <Appearance />

        {/* Recipe language */}
        <Section
          title="Recipe language"
          note="New recipes are translated into this language when you add them. Ingredient names stay in English so shopping lists merge correctly."
        >
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="recipe-language-select" className="sr-only">
              Recipe language
            </label>
            <select
              id="recipe-language-select"
              value={language ?? "en"}
              onChange={(e) => saveLanguage(e.target.value)}
              className={selectCls}
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            {languageMsg && <StatusNote msg={languageMsg} />}
          </div>
        </Section>

        {/* Change password — only for accounts that have one. */}
        {user.hasPassword && (
          <Section title="Change password">
            <form onSubmit={changePassword} className="flex flex-col gap-3">
              <input
                type="password"
                required
                placeholder="Current password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                autoComplete="current-password"
                className={inputCls}
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder="New password (min 8 chars)"
                value={pwNext}
                onChange={(e) => setPwNext(e.target.value)}
                autoComplete="new-password"
                className={inputCls}
              />
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button type="submit" className={primaryBtnCls}>
                  Change password
                </button>
                {pwMsg && <StatusNote msg={pwMsg} />}
              </div>
            </form>
          </Section>
        )}

        {/* Todoist */}
        <Section
          title="Todoist"
          note={
            <>
              Paste your Todoist API token and the name of the project where the
              shopping list should land. {todoistFallbackHint}
            </>
          }
        >
          <form onSubmit={saveTodoist} className="flex flex-col gap-3">
            <label className="flex flex-col gap-[7px]">
              <FieldLabel>
                API token{" "}
                {todoistHasToken && (
                  <span className="ml-1 text-[10px] font-bold text-sage">(set)</span>
                )}
              </FieldLabel>
              <input
                type="password"
                placeholder={todoistHasToken ? "Replace token…" : "Paste token"}
                value={todoistTokenInput}
                onChange={(e) => setTodoistTokenInput(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-[7px]">
              <FieldLabel>Project name</FieldLabel>
              <input
                type="text"
                placeholder="Shopping"
                value={todoistProjectInput}
                onChange={(e) => setTodoistProjectInput(e.target.value)}
                className={inputCls}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button type="submit" className={primaryBtnCls}>
                Save
              </button>
              {(todoistHasToken || todoistProject) && (
                <button type="button" onClick={clearTodoist} className={ghostBtnCls}>
                  Clear
                </button>
              )}
              {todoistMsg && <StatusNote msg={todoistMsg} />}
            </div>
          </form>
        </Section>

        {/* Pantry defaults */}
        <Section
          title="Pantry defaults"
          count={pantryDefaults.length}
          note={
            <>
              Ingredient names in this list auto-flag <code>pantry: true</code>{" "}
              when used in any dish. They&rsquo;re excluded from the shopping list
              and Todoist push. Match is case-insensitive, exact name (no fuzzy).
            </>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addPantryDefault(newPantryName);
              setNewPantryName("");
            }}
            className="mb-4 flex gap-2"
          >
            <input
              list="ingredient-names-for-pantry"
              value={newPantryName}
              onChange={(e) => setNewPantryName(e.target.value)}
              placeholder="add pantry name…"
              className={`${inputCls} flex-1`}
            />
            <button
              type="submit"
              disabled={!newPantryName.trim()}
              className={primaryBtnCls}
            >
              Add
            </button>
          </form>
          <datalist id="ingredient-names-for-pantry">
            {ingredientNameOptions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {pantryDefaults.length === 0 ? (
            <p className="text-[13px] text-text-faint">No pantry defaults yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {pantryDefaults.map((name) => (
                <span
                  key={name}
                  className="group inline-flex items-center gap-[6px] rounded-pill border border-line bg-surface-2 px-[11px] py-[5px] text-[12.5px] text-text"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => removePantryDefault(name)}
                    className="grid h-[16px] w-[16px] place-items-center rounded-pill text-text-faint transition-colors hover:bg-rose-tint hover:text-rose"
                    aria-label={`remove ${name} from pantry defaults`}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* Backup */}
        <Section
          title="Backup"
          note="Download a JSON snapshot of your dishes, pantry defaults, and meal plan. Import the same file to restore. Dishes upsert by id; pantry names are additive; meal plan is replaced."
        >
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={downloadBackup} className={primaryBtnCls}>
              <Icon name="arrowR" size={15} style={{ transform: "rotate(90deg)" }} />
              Download backup
            </button>
            <label
              className={`${ghostBtnCls} cursor-pointer`}
            >
              {importing ? "Importing…" : "Import backup"}
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importBackup(file);
                  e.target.value = "";
                }}
              />
            </label>
            {backupMsg && <StatusNote msg={backupMsg} />}
          </div>
        </Section>
      </div>
    </>
  );
}

function Appearance() {
  const { setting, effective, set } = useTheme();
  const options: Array<{ value: ThemeSetting; label: string; icon: IconName }> = [
    { value: "system", label: "System", icon: "theme-auto" },
    { value: "light",  label: "Light",  icon: "sun" },
    { value: "dark",   label: "Dark",   icon: "moon" },
  ];
  return (
    <Section title="Appearance">
      <div className="flex gap-2" role="radiogroup" aria-label="Theme">
        {options.map((o) => {
          const active = setting === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => set(o.value)}
              className={[
                "flex flex-1 flex-col items-center gap-[7px] rounded-[var(--radius-md)] border p-[14px] transition-colors",
                active
                  ? "border-accent-line bg-accent-tint text-accent-2"
                  : "border-line bg-surface-2 text-text-dim hover:border-line-2 hover:text-text",
              ].join(" ")}
            >
              <Icon name={o.icon} size={20} />
              <span className="text-[13px] font-medium" style={{ fontFamily: "var(--font-sans)" }}>
                {o.label}
              </span>
            </button>
          );
        })}
      </div>
      {setting === "system" && (
        <p className="mt-[10px] text-[12px] text-text-faint">
          Following system: currently {effective}.
        </p>
      )}
    </Section>
  );
}

// ── V2 shared bits ──────────────────────────────────────────────────────────

const inputCls =
  "w-full min-w-0 rounded-[var(--radius-md)] border border-line bg-surface-2 px-[13px] py-[11px] text-[14.5px] text-text placeholder:text-text-faint transition-colors focus:border-accent-line focus:outline-none";
const selectCls =
  "rounded-[var(--radius-md)] border border-line bg-surface-2 px-[13px] py-[10px] text-[14px] text-text transition-colors focus:border-accent-line focus:outline-none";
const primaryBtnCls =
  "inline-flex items-center justify-center gap-[6px] rounded-pill border border-accent bg-accent px-[16px] py-[9px] text-[13px] font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50";
const ghostBtnCls =
  "inline-flex items-center justify-center gap-[6px] rounded-pill border border-line bg-surface-2 px-[16px] py-[9px] text-[13px] font-semibold text-text-dim transition-colors hover:border-line-2 hover:text-text";

// A settings panel: an eyebrow label (with optional count) above a clean
// surface card. Matches the dish-form's `Section` rhythm but wraps its body in
// a bordered card since settings panels are standalone.
function Section({
  title,
  note,
  count,
  children,
}: {
  title: string;
  note?: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section>
      <div
        className="mb-[4px] text-[11px] font-semibold uppercase tracking-[0.18em] text-accent"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {title}
        {count != null && <span className="text-text-faint"> · {count}</span>}
      </div>
      {note && (
        <p className="mb-[12px] text-[12px] leading-[1.45] text-text-faint">{note}</p>
      )}
      <div
        className={`rounded-[var(--radius-lg)] border border-line bg-surface p-[16px] shadow-[var(--shadow-card)] ${note ? "" : "mt-[12px]"}`}
      >
        {children}
      </div>
    </section>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-faint"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {children}
    </span>
  );
}

// Inline status note — sage for success, rose for an error, dim otherwise.
// Heuristic on the message text keeps the existing single-string state shape.
function StatusNote({ msg }: { msg: string }) {
  const lower = msg.toLowerCase();
  const isError =
    lower.startsWith("http") ||
    lower.includes("wrong") ||
    lower.includes("failed") ||
    lower.includes("must be") ||
    lower.includes("not valid") ||
    lower.includes("no password") ||
    lower.includes("error");
  const ok =
    msg === "Saved." ||
    msg === "Cleared." ||
    msg === "Downloaded." ||
    msg === "Password changed." ||
    msg.startsWith("Imported");
  const color = isError ? "text-rose" : ok ? "text-sage" : "text-text-dim";
  return <span className={`text-[13px] ${color}`}>{msg}</span>;
}

function messageForPwError(code: string | undefined): string {
  switch (code) {
    case "password_too_short":
      return "New password must be at least 8 characters.";
    case "wrong_current_password":
      return "Current password is wrong.";
    case "no_password_set":
      return "Your account has no password (Google sign-in only).";
    default:
      return "Password change failed.";
  }
}
