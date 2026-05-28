if (typeof window !== "undefined") {
  throw new Error("auth-helpers.ts should only be imported from server-side code");
}

import bcrypt from "bcryptjs";
import { timingSafeEqual } from "node:crypto";

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

// Profile handle rules: lowercase, alphanumerics + dash + underscore,
// 3-30 chars. The same regex is enforced server-side on /api/me/profile.
export const HANDLE_REGEX = /^[a-z0-9_-]{3,30}$/;
const HANDLE_MIN = 3;
const HANDLE_MAX = 30;

/**
 * Derive a candidate handle slug from an email address. Strips non-handle
 * characters, lowercases, trims to {@link HANDLE_MAX}, pads short slugs
 * with random suffix bytes. The result always matches HANDLE_REGEX.
 *
 * NOT collision-checked — callers should run {@link assignAvailableHandle}
 * against the DB before using.
 */
export function slugFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  let s = local
    .toLowerCase()
    .replace(/\./g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (s.length < HANDLE_MIN) {
    const pad = Math.random().toString(36).slice(2, 2 + HANDLE_MIN);
    s = (s + pad).slice(0, HANDLE_MAX);
  }
  if (s.length > HANDLE_MAX) s = s.slice(0, HANDLE_MAX);
  return s;
}

/**
 * Picks an available handle for a user, starting from `base` and trying
 * `base`, `base-2`, `base-3`, ... up to `base-99`. Throws on overflow.
 * `existsCheck` returns true if a handle is already taken.
 */
export async function assignAvailableHandle(
  base: string,
  existsCheck: (handle: string) => Promise<boolean>,
): Promise<string> {
  if (!HANDLE_REGEX.test(base)) {
    // Defensive: caller passed something invalid. Normalize by truncation.
    base = base.slice(0, HANDLE_MAX);
    if (!HANDLE_REGEX.test(base)) {
      throw new Error(`invalid base handle: ${base}`);
    }
  }
  if (!(await existsCheck(base))) return base;
  for (let n = 2; n <= 99; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, HANDLE_MAX - suffix.length) + suffix;
    if (!(await existsCheck(candidate))) return candidate;
  }
  throw new Error(`no available handle for base ${base}`);
}

// Resolves the acting user_id for an incoming request. Returns null when
// the request is unauthenticated. Two paths:
//   1. Authorization: Bearer $API_TOKEN  -> seed owner's user_id.
//   2. NextAuth JWT session              -> session.user.id.
// The bearer path exists for the curl/script use case. There is no
// per-user token minting yet.
export async function resolveUserId(req: Request): Promise<string | null> {
  const bearer = bearerToken(req);
  if (bearer && process.env.API_TOKEN && constantTimeEqual(bearer, process.env.API_TOKEN)) {
    const seedEmail = (process.env.SEED_OWNER_EMAIL ?? "").trim().toLowerCase();
    if (!seedEmail) return null;
    const { sql } = await import("@/lib/db");
    const rows = await sql`SELECT id FROM users WHERE email = ${seedEmail} LIMIT 1`;
    return (rows[0]?.id as string | undefined) ?? null;
  }
  // Lazy import to avoid a top-level cycle: lib/auth -> lib/auth-helpers -> lib/auth.
  const { auth } = await import("@/lib/auth");
  const session = await auth();
  return (session?.user?.id as string | undefined) ?? null;
}

function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const prefix = "Bearer ";
  if (!h.startsWith(prefix)) return null;
  return h.slice(prefix.length);
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
