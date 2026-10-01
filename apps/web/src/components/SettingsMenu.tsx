import { useEffect, useRef, useState } from "react";
import { LANGUAGES, type Language } from "../i18n";
import { useSettings, type ThemePreference } from "../settings";
import { Segmented } from "./Segmented";
import { Switch } from "./Switch";

// Top-right gear: language, theme and the zoom indicator (settings.tsx
// holds and persists them). Closes on a click outside or Escape.
export function SettingsMenu({ style }: { style?: React.CSSProperties }) {
  const { settings, update, i18n } = useSettings();
  const { t } = i18n;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const themeOptions: Array<{ value: ThemePreference; label: string; title?: string }> = [
    { value: "light", label: t("settings.themeLight") },
    { value: "dark", label: t("settings.themeDark") },
    { value: "auto", label: t("settings.themeAuto"), title: t("settings.themeAutoHint") },
  ];

  return (
    <div ref={rootRef} style={{ position: "absolute", zIndex: 3, ...style }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("settings.open")}
        title={t("settings.open")}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "2.1rem",
          height: "2.1rem",
          padding: 0,
          borderRadius: "50%",
          border: "none",
          background: "var(--panel-bg)",
          color: "var(--text)",
          boxShadow: "0 1px 4px var(--shadow)",
        }}
      >
        <GearIcon />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("settings.open")}
          style={{
            position: "absolute",
            top: "2.6rem",
            right: 0,
            width: "15rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            padding: "0.75rem",
            fontSize: "0.8rem",
            background: "var(--panel-bg)",
            color: "var(--text)",
            borderRadius: 6,
            boxShadow: "0 1px 4px var(--shadow)",
          }}
        >
          <div style={field}>
            <span style={fieldLabel}>{t("settings.language")}</span>
            <Segmented
              label={t("settings.language")}
              value={settings.language}
              options={(Object.keys(LANGUAGES) as Language[]).map((lang) => ({
                value: lang,
                label: LANGUAGES[lang].label,
              }))}
              onChange={(language) => update({ language })}
            />
          </div>
          <div style={field}>
            <span style={fieldLabel}>{t("settings.theme")}</span>
            <Segmented
              label={t("settings.theme")}
              value={settings.theme}
              options={themeOptions}
              onChange={(theme) => update({ theme })}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ ...fieldLabel, flex: 1 }}>{t("settings.zoomIndicator")}</span>
            <Switch
              label={t("settings.zoomIndicator")}
              checked={settings.showZoom}
              onChange={(showZoom) => update({ showZoom })}
            />
          </div>
          {/* The AGPL (LICENSE) asks a network-served program to offer its
              source to its users: this is that offer. */}
          <div style={footer}>
            <a
              href={settings.language === "es" ? "/docs/es/" : "/docs/"}
              target="_blank"
              rel="noopener"
            >
              {t("settings.docs")}
            </a>
            <span aria-hidden>·</span>
            <a href={SOURCE_URL} target="_blank" rel="noopener">
              {t("settings.source")}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

const SOURCE_URL = "https://github.com/arredond/twiner";

const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "0.3rem" };
const footer: React.CSSProperties = {
  display: "flex",
  gap: "0.4rem",
  paddingTop: "0.5rem",
  borderTop: "1px solid var(--border)",
  color: "var(--text-muted)",
};
const fieldLabel: React.CSSProperties = { fontWeight: 600 };

function GearIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
