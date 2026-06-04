import { z } from "zod";
import { DishInputSchema } from "../types.ts";

type JsonNode = Record<string, unknown>;

// claude-agent reconstructs this schema via json-schema-to-zod, which does NOT
// support `anyOf`. Every `.nullable()` field becomes `anyOf:[X,{type:"null"}]`
// and degrades to z.unknown() there — so claude-agent can't enforce the field
// (the model then emits e.g. methodRefs as a JSON string). The ingest agent
// only ever PRODUCES values (it omits absent fields rather than sending null),
// so we drop the null branch from every anyOf, leaving a plain typed node that
// json-schema-to-zod handles. Recurses through properties and items.
export function stripNullFromAnyOf(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripNullFromAnyOf);
  if (!node || typeof node !== "object") return node;
  const obj = node as JsonNode;
  let working: JsonNode = obj;
  if (Array.isArray(obj.anyOf)) {
    const nonNull = (obj.anyOf as unknown[]).filter(
      (m) => !(m && typeof m === "object" && (m as JsonNode).type === "null"),
    );
    if (nonNull.length === 1 && typeof nonNull[0] === "object") {
      // Collapse to the single remaining branch, preserving sibling keys
      // (e.g. description) but dropping the now-empty anyOf.
      const { anyOf: _drop, ...rest } = obj;
      working = { ...rest, ...(nonNull[0] as JsonNode) };
    } else {
      working = { ...obj, anyOf: nonNull };
    }
  }
  const out: JsonNode = {};
  for (const [k, v] of Object.entries(working)) {
    out[k] = stripNullFromAnyOf(v);
  }
  return out;
}

const { $schema: _unused, ...raw } = z.toJSONSchema(DishInputSchema) as Record<
  string,
  unknown
>;
export const DISH_INPUT_JSON_SCHEMA = stripNullFromAnyOf(raw) as Record<
  string,
  unknown
>;
