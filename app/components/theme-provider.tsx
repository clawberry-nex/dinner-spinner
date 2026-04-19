"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type ThemeContextValue = { dark: boolean; toggleDark: () => void };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

export const themeScript = `
(function(){try{
  var s=localStorage.getItem('ds_dark');
  var m=window.matchMedia('(prefers-color-scheme: dark)').matches;
  var d=s==null?m:s==='1';
  document.documentElement.setAttribute('data-mode', d?'dark':'light');
}catch(e){}})();`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(document.documentElement.getAttribute("data-mode") === "dark");
  }, []);

  const toggleDark = useCallback(() => {
    setDark((d) => {
      const next = !d;
      document.documentElement.setAttribute("data-mode", next ? "dark" : "light");
      try { localStorage.setItem("ds_dark", next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ dark, toggleDark }}>{children}</ThemeContext.Provider>;
}
