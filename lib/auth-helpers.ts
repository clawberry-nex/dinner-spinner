import "server-only";

if (typeof window !== "undefined") {
  throw new Error("auth-helpers.ts should only be imported from server-side code");
}

import bcrypt from "bcryptjs";

export type Allowlist =
  | { mode: "deny-all"; emails: Set<string> }
  | { mode: "allow-all"; emails: Set<string> }
  | { mode: "allow-listed"; emails: Set<string> };

export function parseAllowlist(raw: string | undefined): Allowlist {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { mode: "deny-all", emails: new Set() };
  if (trimmed === "*") return { mode: "allow-all", emails: new Set() };
  const emails = new Set(
    trimmed
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return { mode: "allow-listed", emails };
}

export function isEmailAllowed(email: string, list: Allowlist): boolean {
  if (list.mode === "deny-all") return false;
  if (list.mode === "allow-all") return true;
  return list.emails.has(email.trim().toLowerCase());
}

const BCRYPT_ROUNDS = 10;
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
