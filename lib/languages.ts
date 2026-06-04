// lib/languages.ts
// Supported recipe/UI languages. `default_language` on users stores the
// `code` (or NULL = English). The ingest prompt translates all human-readable
// recipe text into the user's chosen language; English is the canonical
// default and the language of ingredient `name` vocabulary.

export type SupportedLanguage = { code: string; label: string };

// English first — it is the default and the canonical ingredient-name language.
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "en", label: "English" },
  { code: "nl", label: "Dutch" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
];

const BY_CODE = new Map(SUPPORTED_LANGUAGES.map((l) => [l.code, l.label]));

// Resolve a stored code to a human language name for the ingest prompt.
// NULL / unknown / undefined → "English" (the default target).
export function languageName(code: string | null | undefined): string {
  if (!code) return "English";
  return BY_CODE.get(code.trim().toLowerCase()) ?? "English";
}

// NULL is allowed (means "use default" = English). Otherwise must be a known code.
export function isSupportedLanguage(code: string | null | undefined): boolean {
  if (code === null || code === undefined) return true;
  return BY_CODE.has(code.trim().toLowerCase());
}
