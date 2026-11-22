export const DISH_TYPES = ["main", "side", "other"] as const;
export type DishType = (typeof DISH_TYPES)[number];

export const DISH_TYPE_LABELS = {
  main: { singular: "Main dish", plural: "Main dishes" },
  side: { singular: "Side dish", plural: "Side dishes" },
  other: { singular: "Other", plural: "Other recipes" },
} satisfies Record<DishType, { singular: string; plural: string }>;
