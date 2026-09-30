import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BUILTIN_BASEMAPS,
  THEME_BASEMAP,
  basemapLabel,
  parseSourceUrl,
  parseWmtsCapabilities,
  resolveBasemap,
  thumbnailUrl,
  type Basemap,
  type CustomBasemap,
  type View,
  type WmtsLayerOption,
} from "../basemaps";
import type { I18n, TranslationKey } from "../i18n";
import { useSettings } from "../settings";

// Bottom-right basemap picker, Google Maps style: a miniature of the
// current basemap that opens a row of the others (built-in and user-added,
// basemaps.ts), plus a "+" to add a WMTS or XYZ raster source. The choice
// lives in Settings (settings.ts), so it's remembered per browser.
export function BasemapPicker({ view, style }: { view: View; style?: React.CSSProperties }) {
  const { settings, update, theme, i18n } = useSettings();
  const { t } = i18n;
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = resolveBasemap(settings.basemap, settings.customBasemaps, theme);
  const all: Basemap[] = [...BUILTIN_BASEMAPS, ...settings.customBasemaps];

  useEffect(() => {
    if (!open || adding) return;
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
  }, [open, adding]);

  // Picking the theme's own Carto style goes back to following the theme
  // (null), so switching light/dark keeps swapping it as before; any other
  // pick sticks across theme switches.
  const choose = (id: string) => update({ basemap: id === THEME_BASEMAP[theme] ? null : id });

  const remove = (id: string) =>
    update({
      customBasemaps: settings.customBasemaps.filter((b) => b.id !== id),
      basemap: settings.basemap === id ? null : settings.basemap,
    });

  const add = (basemap: CustomBasemap) => {
    update({ customBasemaps: [...settings.customBasemaps, basemap], basemap: basemap.id });
    setAdding(false);
    setOpen(false);
  };

  return (
    <div ref={rootRef} style={{ position: "absolute", zIndex: 3, display: "flex", alignItems: "flex-end", ...style }}>
      {open && (
        <div
          role="listbox"
          aria-label={t("basemap.open")}
          style={{
            marginRight: "0.5rem",
            // Four per row: the built-ins and "+" make two rows; user-added
            // sources add more, the panel growing upward from the button.
            display: "grid",
            gridTemplateColumns: "repeat(4, auto)",
            gap: "0.5rem",
            padding: "0.5rem",
            background: "var(--panel-bg)",
            borderRadius: 8,
            boxShadow: "0 1px 4px var(--shadow)",
          }}
        >
          {all.map((b) => (
            <Option
              key={b.id}
              basemap={b}
              label={basemapLabel(b, t)}
              view={view}
              selected={b.id === current.id}
              onSelect={() => choose(b.id)}
              onRemove={"name" in b ? () => remove(b.id) : undefined}
              removeLabel={t("basemap.remove", { name: basemapLabel(b, t) })}
            />
          ))}
          <button
            type="button"
            onClick={() => setAdding(true)}
            title={t("basemap.add")}
            aria-label={t("basemap.add")}
            style={{ ...tileStyle, ...optionButtonStyle }}
          >
            <span
              style={{
                ...thumbStyle,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px dashed var(--border-input)",
                color: "var(--text-muted)",
              }}
            >
              <PlusIcon />
            </span>
            <span style={labelStyle}>{t("basemap.addShort")}</span>
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("basemap.open")}
        title={t("basemap.open")}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          position: "relative",
          width: "4.5rem",
          height: "4.5rem",
          padding: 0,
          border: "2px solid var(--surface)",
          borderRadius: 8,
          overflow: "hidden",
          background: "var(--sunken)",
          boxShadow: "0 1px 4px var(--shadow)",
          cursor: "pointer",
        }}
      >
        <Thumbnail basemap={current} view={view} />
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.2rem",
            padding: "0.15rem 0",
            fontSize: "0.65rem",
            fontWeight: 600,
            color: "#fff",
            background: "linear-gradient(transparent, rgba(0,0,0,0.65))",
          }}
        >
          <LayersIcon />
          {t("basemap.label")}
        </span>
      </button>
      {adding &&
        createPortal(<AddBasemapModal i18n={i18n} onAdd={add} onClose={() => setAdding(false)} />, document.body)}
    </div>
  );
}

const tileStyle: React.CSSProperties = {
  width: "4.25rem",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "0.2rem",
};
const optionButtonStyle: React.CSSProperties = {
  padding: 0,
  border: "none",
  background: "none",
  color: "var(--text)",
  cursor: "pointer",
};
const thumbStyle: React.CSSProperties = {
  width: "3.5rem",
  height: "3.5rem",
  borderRadius: 6,
  overflow: "hidden",
  background: "var(--sunken)",
  boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  fontSize: "0.65rem",
  lineHeight: 1.15,
  textAlign: "center",
  overflowWrap: "anywhere",
};

function Thumbnail({ basemap, view }: { basemap: Basemap; view: View }) {
  const src = thumbnailUrl(basemap, view);
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed(src)}
      style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
}

function Option({
  basemap,
  label,
  view,
  selected,
  onSelect,
  onRemove,
  removeLabel,
}: {
  basemap: Basemap;
  label: string;
  view: View;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
  removeLabel: string;
}) {
  return (
    <div style={{ ...tileStyle, position: "relative" }}>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onSelect}
        title={label}
        style={{ ...tileStyle, ...optionButtonStyle, fontWeight: selected ? 600 : 400 }}
      >
        <span
          style={{
            ...thumbStyle,
            border: selected ? "2px solid var(--link)" : "1px solid var(--border)",
          }}
        >
          <Thumbnail basemap={basemap} view={view} />
        </span>
        <span style={{ ...labelStyle, color: selected ? "var(--link)" : "var(--text)" }}>{label}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={removeLabel}
          aria-label={removeLabel}
          style={{
            position: "absolute",
            top: -4,
            right: 0,
            width: "1.1rem",
            height: "1.1rem",
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text-muted)",
            fontSize: "0.75rem",
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// Error messages carry an i18n key when they're ours (basemaps.ts).
function errorText(err: unknown, i18n: I18n): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.startsWith("basemap.custom.") && i18n.has(message) ? i18n.t(message as TranslationKey) : message;
}

// The "+": paste a tile URL template (XYZ, WMTS REST or a GetTile
// request) and it's added as is; paste a WMTS service and its
// capabilities are read for a layer to pick.
function AddBasemapModal({
  i18n,
  onAdd,
  onClose,
}: {
  i18n: I18n;
  onAdd: (basemap: CustomBasemap) => void;
  onClose: () => void;
}) {
  const { t } = i18n;
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [layers, setLayers] = useState<WmtsLayerOption[] | null>(null);
  const [layerId, setLayerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const finish = (basemap: WmtsLayerOption["basemap"], fallbackName: string) =>
    onAdd({
      ...basemap,
      kind: "raster",
      id: `custom-${Date.now().toString(36)}`,
      name: name.trim() || fallbackName,
    });

  const submit = async () => {
    setError(null);
    if (layers) {
      const layer = layers.find((l) => l.id === layerId);
      if (layer) finish(layer.basemap, layer.title);
      return;
    }
    let parsed;
    try {
      parsed = parseSourceUrl(url);
    } catch (err) {
      setError(errorText(err, i18n));
      return;
    }
    if (parsed.kind === "template") {
      finish(parsed.basemap, new URL(url.trim()).hostname);
      return;
    }
    setBusy(true);
    try {
      let xml: string;
      try {
        const response = await fetch(parsed.capabilitiesUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        xml = await response.text();
      } catch (err) {
        throw new Error(t("basemap.custom.errorFetch", { message: err instanceof Error ? err.message : String(err) }));
      }
      const options = parseWmtsCapabilities(xml, parsed.capabilitiesUrl);
      if (options.length === 0) throw new Error("basemap.custom.errorNoLayers");
      setLayers(options);
      setLayerId(options[0].id);
    } catch (err) {
      setError(errorText(err, i18n));
    } finally {
      setBusy(false);
    }
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "0.35rem 0.45rem",
    fontSize: "0.8rem",
    border: "1px solid var(--border-input)",
    borderRadius: 4,
    background: "var(--surface)",
    color: "var(--text)",
  };

  return (
    <div
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        background: "rgba(0,0,0,0.4)",
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={t("basemap.custom.title")}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        style={{
          width: "min(30rem, 100%)",
          display: "flex",
          flexDirection: "column",
          gap: "0.7rem",
          padding: "1rem",
          fontSize: "0.8rem",
          background: "var(--surface)",
          color: "var(--text)",
          borderRadius: 8,
          boxShadow: "0 4px 16px var(--shadow)",
        }}
      >
        <strong style={{ fontSize: "0.95rem" }}>{t("basemap.custom.title")}</strong>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {t("basemap.custom.url")}
          <input
            ref={inputRef}
            type="url"
            required
            value={url}
            disabled={layers !== null}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.ign.es/wmts/pnoa-ma"
            style={fieldStyle}
          />
          <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>{t("basemap.custom.urlHint")}</span>
        </label>
        {layers && (
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {t("basemap.custom.layer")}
            <select value={layerId} onChange={(e) => setLayerId(e.target.value)} style={fieldStyle}>
              {layers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title === l.id ? l.id : `${l.title} (${l.id})`}
                </option>
              ))}
            </select>
          </label>
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {t("basemap.custom.name")}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} />
        </label>
        {busy && <span style={{ color: "var(--text-muted)" }}>{t("basemap.custom.loading")}</span>}
        {error && <span style={{ color: "var(--danger)" }}>{error}</span>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={layers ? () => setLayers(null) : onClose}
            style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem", cursor: "pointer" }}
          >
            {layers ? t("basemap.custom.back") : t("basemap.custom.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy}
            style={{
              padding: "0.35rem 0.8rem",
              fontSize: "0.8rem",
              fontWeight: 600,
              border: "1px solid var(--accent-bg)",
              borderRadius: 4,
              background: "var(--accent-bg)",
              color: "var(--accent-fg)",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {t("basemap.custom.add")}
          </button>
        </div>
      </form>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 2 8.5 12 14l10-5.5L12 3Z" />
      <path d="m2 15.5 10 5.5 10-5.5" />
    </svg>
  );
}
