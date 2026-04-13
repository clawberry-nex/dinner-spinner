import { z } from "zod";

export const IngredientSchema = z.object({
  quantity: z.number().nonnegative(),
  unit: z.string().trim().max(32).nullable().optional(),
  name: z.string().trim().min(1).max(128),
});

export type Ingredient = z.infer<typeof IngredientSchema>;

export const DishInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(300).nullable().optional(),
  recipe: z.string().max(20_000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).default([]),
  ingredients: z.array(IngredientSchema).default([]),
  baseServings: z.number().int().positive().max(100).default(4),
});

export type DishInput = z.infer<typeof DishInputSchema>;

export type Dish = {
  id: number;
  title: string;
  subtitle: string | null;
  recipe: string | null;
  tags: string[];
  ingredients: Ingredient[];
  baseServings: number;
  createdAt: string;
  updatedAt: string;
};

export function rowToDish(row: Record<string, unknown>): Dish {
  return {
    id: row.id as number,
    title: row.title as string,
    subtitle: (row.subtitle as string | null) ?? null,
    recipe: (row.recipe as string | null) ?? null,
    tags: (row.tags as string[]) ?? [],
    ingredients: (row.ingredients as Ingredient[]) ?? [],
    baseServings: row.base_servings as number,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
