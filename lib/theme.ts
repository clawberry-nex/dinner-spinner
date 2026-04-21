export type ThemeSetting = "system" | "light" | "dark";
export type EffectiveMode = "light" | "dark";

const KEY = "ds_theme";
const LEGACY_KEY = "ds_dark";

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function isSetting(v: unknown): v is ThemeSetting {
  return v === "system" || v === "light" || v === "dark";
}

export function readThemeSetting(storage: StorageLike): ThemeSetting {
  let setting: ThemeSetting = "system";
  const raw = storage.getItem(KEY);
  if (isSetting(raw)) {
    setting = raw;
  } else {
    const legacy = storage.getItem(LEGACY_KEY);
    if (legacy === "1") setting = "dark";
    else if (legacy === "0") setting = "light";
    if (legacy === "1" || legacy === "0") {
      writeThemeSetting(storage, setting);
    }
  }
  if (storage.getItem(LEGACY_KEY) !== null) {
    storage.removeItem(LEGACY_KEY);
  }
  return setting;
}

export function writeThemeSetting(
  storage: StorageLike,
  setting: ThemeSetting,
): void {
  if (setting === "system") {
    storage.removeItem(KEY);
  } else {
    storage.setItem(KEY, setting);
  }
}

export function resolveEffective(
  setting: ThemeSetting,
  systemPrefersDark: boolean,
): EffectiveMode {
  if (setting === "dark") return "dark";
  if (setting === "light") return "light";
  return systemPrefersDark ? "dark" : "light";
}

export function nextSetting(current: ThemeSetting): ThemeSetting {
  switch (current) {
    case "system":
      return "light";
    case "light":
      return "dark";
    case "dark":
      return "system";
  }
}
