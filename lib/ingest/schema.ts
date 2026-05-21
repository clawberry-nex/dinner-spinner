import { z } from "zod";
import { DishInputSchema } from "../types.ts";

// Zod v4's native JSON Schema export — produces a flat object schema
// suitable as Anthropic's tool `input_schema`. Auto-syncs with DishInputSchema.
export const DISH_INPUT_JSON_SCHEMA = z.toJSONSchema(DishInputSchema);
