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
import { isThemeId, themeNames, themes, type ThemeId } from "@/lib/themes";

export type { ThemeId };

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
    if (isThemeId(stored)) setThemeId(stored);
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
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/** Theme Pack picker. Players find it in Profile; dev tools float it. */
export function ThemeSwitcher({
  floating = false,
}: {
  readonly floating?: boolean;
}) {
  const { themeId, setThemeId } = useGameTheme();
  return (
    <label className={floating ? "global-theme-switcher" : "theme-switcher"}>
      <span>Theme pack</span>
      <select
        aria-label="Theme pack"
        onChange={(event) => setThemeId(event.target.value as ThemeId)}
        value={themeId}
      >
        {Object.entries(themeNames).map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function useGameTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useGameTheme requires ThemeProvider");
  return value;
}
