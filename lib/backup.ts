import { z } from "zod";

export const CURRENT_BACKUP_VERSION = "1" as const;

const BackupDishSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  subtitle: z.string().nullable(),
  recipe: z.string().nullable(),
  tags: z.array(z.string()),
  ingredients: z.array(z.record(z.string(), z.unknown())),
  baseServings: z.number().int().positive(),
  favorite: z.boolean(),
  imageUrl: z.string().nullable(),
  emoji: z.string().nullable(),
  accent: z.string().nullable(),
  lastCookedAt: z.string().nullable(),
  averageRating: z.number().nullable(),
  ratingCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const MealPlanEntrySchema = z.object({
  id: z.number().int().positive(),
  servings: z.number().int().positive().max(100),
  day: z.number().int().min(0).max(6).nullable().optional(),
});

export const BackupEnvelopeSchema = z.object({
  version: z.literal(CURRENT_BACKUP_VERSION),
  exportedAt: z.string(),
  appVersion: z.string(),
  dishes: z.array(BackupDishSchema),
  pantryNames: z.array(z.string()),
  mealPlan: z.object({
    entries: z.array(MealPlanEntrySchema),
  }),
});

export type BackupEnvelope = z.infer<typeof BackupEnvelopeSchema>;
export type BackupDish = z.infer<typeof BackupDishSchema>;
export type BackupMealPlanEntry = z.infer<typeof MealPlanEntrySchema>;

export type BuildBackupInput = {
  dishes: BackupDish[];
  pantryNames: string[];
  mealPlan: { entries: BackupMealPlanEntry[] };
  appVersion: string;
  now?: Date;
};

export function buildBackup(input: BuildBackupInput): BackupEnvelope {
  const now = input.now ?? new Date();
  return {
    version: CURRENT_BACKUP_VERSION,
    exportedAt: now.toISOString(),
    appVersion: input.appVersion,
    dishes: input.dishes,
    pantryNames: input.pantryNames
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean),
    mealPlan: input.mealPlan,
  };
}

export function parseBackup(raw: unknown): BackupEnvelope {
  return BackupEnvelopeSchema.parse(raw);
}
