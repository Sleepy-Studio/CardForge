"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ThemeManifest } from "@cardforge/card-schema";
import { defaultTheme } from "@cardforge/theme-default";
import { orbitalTheme } from "@cardforge/theme-test-scifi";

const themes = {
  aetherfront: defaultTheme,
  "orbital-conflict": orbitalTheme,
} as const;
export type ThemeId = keyof typeof themes;

interface ThemeContextValue {
  readonly theme: ThemeManifest;
  readonly themeId: ThemeId;
  readonly setThemeId: (themeId: ThemeId) => void;
  readonly term: (semanticId: string) => string;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>("aetherfront");
  const theme = themes[themeId];

  useEffect(() => {
    const stored = window.localStorage.getItem("cardforge.theme");
    if (stored === "aetherfront" || stored === "orbital-conflict")
      setThemeId(stored);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("cardforge.theme", themeId);
    document.documentElement.dataset.gameTheme = themeId;
    document.documentElement.style.setProperty("--ink", theme.palette.canvas);
    document.documentElement.style.setProperty("--text", theme.palette.text);
    document.documentElement.style.setProperty(
      "--cyan",
      theme.palette.secondary,
    );
    document.documentElement.style.setProperty("--mint", theme.palette.primary);
    document.documentElement.style.setProperty(
      "--danger",
      theme.palette.danger,
    );
  }, [theme, themeId]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      themeId,
      setThemeId,
      term: (semanticId) => theme.terms[semanticId] ?? semanticId,
    }),
    [theme, themeId],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
      <label className="global-theme-switcher">
        <span>Theme pack</span>
        <select
          aria-label="Theme pack"
          onChange={(event) => setThemeId(event.target.value as ThemeId)}
          value={themeId}
        >
          <option value="aetherfront">Aetherfront</option>
          <option value="orbital-conflict">Orbital Conflict</option>
        </select>
      </label>
    </ThemeContext.Provider>
  );
}

export function useGameTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useGameTheme requires ThemeProvider");
  return value;
}
