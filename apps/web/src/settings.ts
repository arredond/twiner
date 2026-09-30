import { createContext, useContext } from "react";
import { isCustomBasemap, isBuiltinBasemapId, type CustomBasemap } from "./basemaps";
import { DEFAULT_LANGUAGE, isLanguage, type I18n, type Language } from "./i18n";

// User-facing UI settings (the top-right gear, SettingsMenu.tsx; held by
// SettingsProvider.tsx): language, light/dark/auto theme and the zoom
// indicator; plus the basemap (bottom-right picker, BasemapPicker.tsx). Kept per browser in localStorage -- a convenience, so everything still works (with the
// defaults) when storage is unavailable.

export type ThemePreference = "light" | "dark" | "auto";
export type Theme = "light" | "dark";

export interface Settings {
  language: Language;
  theme: ThemePreference;
  showZoom: boolean;
  // A BUILTIN_BASEMAPS id or a customBasemaps one; null follows the theme
  // (Positron / Dark Matter, basemaps.ts THEME_BASEMAP).
  basemap: string | null;
  customBasemaps: CustomBasemap[];
}

const DEFAULTS: Settings = {
  language: DEFAULT_LANGUAGE,
  theme: "dark",
  showZoom: false,
  basemap: null,
  customBasemaps: [],
};

// Also read by index.html's inline script, which sets the theme before
// first paint (no light flash on a dark default) -- keep the two in step.
export const STORAGE_KEY = "twiner.settings";

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Record<keyof Settings, unknown>>;
    const customBasemaps = Array.isArray(raw.customBasemaps) ? raw.customBasemaps.filter(isCustomBasemap) : [];
    return {
      language: isLanguage(raw.language) ? raw.language : DEFAULTS.language,
      theme: raw.theme === "light" || raw.theme === "dark" || raw.theme === "auto" ? raw.theme : DEFAULTS.theme,
      showZoom: typeof raw.showZoom === "boolean" ? raw.showZoom : DEFAULTS.showZoom,
      customBasemaps,
      basemap:
        isBuiltinBasemapId(raw.basemap) || customBasemaps.some((b) => b.id === raw.basemap)
          ? (raw.basemap as string)
          : DEFAULTS.basemap,
    };
  } catch {
    return DEFAULTS;
  }
}

export const DARK_QUERY = "(prefers-color-scheme: dark)";

export function systemTheme(): Theme {
  return window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

export interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  // `settings.theme` with "auto" resolved against the system setting.
  theme: Theme;
  i18n: I18n;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside SettingsProvider");
  return value;
}

export function useI18n(): I18n {
  return useSettings().i18n;
}
