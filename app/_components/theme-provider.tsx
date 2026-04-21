"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  nextSetting,
  readThemeSetting,
  resolveEffective,
  writeThemeSetting,
  type EffectiveMode,
  type ThemeSetting,
} from "../../lib/theme";

type ThemeContextValue = {
  setting: ThemeSetting;
  effective: EffectiveMode;
  cycle: () => void;
};
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

// Runs before first paint to avoid FOUC. Mirrors resolveEffective +
// readThemeSetting (including the ds_dark migration) but inlined and
// defensive so a single bad value can't crash the page.
export const themeScript = `
(function(){try{
  var s=localStorage.getItem('ds_theme');
  if(s!=='system'&&s!=='light'&&s!=='dark'){
    var old=localStorage.getItem('ds_dark');
    if(old==='1'){s='dark';localStorage.setItem('ds_theme','dark');}
    else if(old==='0'){s='light';localStorage.setItem('ds_theme','light');}
    else{s='system';}
    if(old!==null)localStorage.removeItem('ds_dark');
  }
  var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;
  var dark=s==='dark'||(s==='system'&&prefersDark);
  document.documentElement.setAttribute('data-mode',dark?'dark':'light');
}catch(e){}})();`;

function applyMode(mode: EffectiveMode) {
  document.documentElement.setAttribute("data-mode", mode);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [setting, setSetting] = useState<ThemeSetting>("system");
  const [effective, setEffective] = useState<EffectiveMode>("light");

  useEffect(() => {
    const stored = readThemeSetting(localStorage);
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const resolved = resolveEffective(stored, mql.matches);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSetting(stored);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEffective(resolved);
    applyMode(resolved);

    const onChange = (e: MediaQueryListEvent) => {
      setSetting((current) => {
        if (current !== "system") return current;
        const next = resolveEffective("system", e.matches);
        setEffective(next);
        applyMode(next);
        return current;
      });
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const cycle = useCallback(() => {
    setSetting((current) => {
      const next = nextSetting(current);
      writeThemeSetting(localStorage, next);
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const resolved = resolveEffective(next, prefersDark);
      setEffective(resolved);
      applyMode(resolved);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ setting, effective, cycle }}>
      {children}
    </ThemeContext.Provider>
  );
}
