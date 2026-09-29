import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createI18n, LANGUAGES } from "./i18n";
import {
  DARK_QUERY,
  loadSettings,
  SettingsContext,
  STORAGE_KEY,
  systemTheme,
  type Settings,
  type SettingsContextValue,
  type Theme,
} from "./settings";

// Holds the UI settings (settings.ts), persists them, and applies the
// theme and language to <html>.
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [system, setSystem] = useState<Theme>(systemTheme);

  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY);
    if (!query) return;
    const onChange = () => setSystem(query.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Not persisted (private window, blocked storage): fine for this session.
    }
  }, [settings]);

  const theme = settings.theme === "auto" ? system : settings.theme;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const i18n = useMemo(() => createI18n(settings.language), [settings.language]);
  useEffect(() => {
    document.documentElement.lang = LANGUAGES[settings.language].locale.split("-")[0];
  }, [settings.language]);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, update: (patch) => setSettings((s) => ({ ...s, ...patch })), theme, i18n }),
    [settings, theme, i18n]
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
