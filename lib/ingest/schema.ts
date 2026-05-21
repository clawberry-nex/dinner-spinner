import { z } from "zod";
import { DishInputSchema } from "../types.ts";

// Zod v4's native JSON Schema export — produces a flat object schema
// suitable as Anthropic's tool `input_schema`. Auto-syncs with DishInputSchema.
// We drop the `$schema` key so the forwarded payload is just the tool's
// input shape; Anthropic's tool_choice path doesn't expect a meta key.
const { $schema: _unused, ...schema } = z.toJSONSchema(DishInputSchema) as Record<
  string,
  unknown
>;
export const DISH_INPUT_JSON_SCHEMA = schema;
