import { DISH_TYPES, DISH_TYPE_LABELS, type DishType } from "@/lib/dish-types";

export function DishTypeOptions() {
  return DISH_TYPES.map((type) => (
    <option key={type} value={type}>{DISH_TYPE_LABELS[type].singular}</option>
  ));
}

export function LibraryDishTypes({ value, onChange }: {
  value: DishType;
  onChange: (value: DishType) => void;
}) {
  return (
    <div role="group" aria-label="Dish type" className="mt-5 inline-flex max-w-full self-start rounded-[var(--radius-md)] border border-line bg-surface-2 p-1">
      {DISH_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          aria-pressed={type === value}
          onClick={() => onChange(type)}
          className={`rounded-[var(--radius-sm)] px-3 py-2 text-[13px] font-semibold transition-colors sm:px-5 ${
            type === value ? "bg-surface text-accent-2 shadow-sm" : "text-text-dim hover:text-text"
          }`}
        >
          {DISH_TYPE_LABELS[type].plural}
        </button>
      ))}
    </div>
  );
}
