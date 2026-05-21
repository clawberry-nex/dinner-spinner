import "server-only";
import { zodToJsonSchema } from "zod-to-json-schema";
import { DishInputSchema } from "../types.ts";

// NOTE: zod-to-json-schema has a compatibility issue with Zod v4.3.6
// (returns empty schema). Using the native zod-to-json-schema would be:
// export const DISH_INPUT_JSON_SCHEMA = zodToJsonSchema(DishInputSchema, {
//   $refStrategy: "none",
// });
//
// Instead, we provide a manually crafted JSON Schema that matches DishInputSchema.
// This is a flat JSON Schema object — what Anthropic expects for a tool's
// `input_schema`. No $ref wrapping, all nested schemas inlined.

export const DISH_INPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      minLength: 1,
      maxLength: 200,
    },
    subtitle: {
      type: ["string", "null"],
      maxLength: 300,
    },
    recipe: {
      type: ["string", "null"],
      maxLength: 20000,
    },
    tags: {
      type: "array",
      items: {
        type: "string",
        minLength: 1,
        maxLength: 40,
      },
      default: [],
    },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quantity: {
            type: "number",
            minimum: 0,
          },
          unit: {
            type: ["string", "null"],
            maxLength: 32,
          },
          name: {
            type: "string",
            minLength: 1,
            maxLength: 128,
          },
          descriptor: {
            type: ["string", "null"],
            maxLength: 60,
          },
          preparation: {
            type: ["string", "null"],
            maxLength: 200,
          },
          pantry: {
            type: ["boolean", "null"],
          },
          scalable: {
            type: ["boolean", "null"],
          },
          optional: {
            type: ["boolean", "null"],
          },
          alternatives: {
            type: ["array", "null"],
            items: {
              type: "string",
              minLength: 1,
              maxLength: 128,
            },
            maxItems: 8,
          },
        },
        required: ["quantity", "name"],
      },
      default: [],
    },
    baseServings: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      default: 4,
    },
    favorite: {
      type: ["boolean", "null"],
    },
    imageUrl: {
      type: ["string", "null"],
      format: "uri",
    },
    emoji: {
      type: ["string", "null"],
      maxLength: 16,
    },
    accent: {
      type: ["string", "null"],
      maxLength: 60,
    },
    notes: {
      type: ["string", "null"],
      maxLength: 5000,
    },
    imageDescription: {
      type: ["string", "null"],
      maxLength: 2000,
    },
  },
  required: ["title"],
} as const;
