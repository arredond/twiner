import { INFRA_CATEGORIES, INFRA_CATEGORY_KEYS, type InfraCategory } from "../infrastructure";

// Critical infrastructure toggles (ADR-0025), next to the legend: a master
// switch and one per category. After a run, each category shows how many
// of its assets the scenario flagged (estimated intensity VI or more, or a
// damaged building); the map colours those by intensity.

interface Props {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  categories: InfraCategory[];
  onCategoriesChange: (categories: InfraCategory[]) => void;
  // Affected assets by category; null before a run, or when the backend
  // has no infrastructure data.
  affectedCounts: Record<string, number> | null;
}

export function InfrastructurePanel({
  enabled,
  onEnabledChange,
  categories,
  onCategoriesChange,
  affectedCounts,
}: Props) {
  const toggle = (key: InfraCategory, on: boolean) =>
    onCategoriesChange(INFRA_CATEGORY_KEYS.filter((k) => (k === key ? on : categories.includes(k))));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
        Show on map
      </label>
      {INFRA_CATEGORIES.map((c) => (
        <label
          key={c.key}
          style={{ display: "flex", alignItems: "center", gap: "0.4rem", opacity: enabled ? 1 : 0.5 }}
        >
          <input
            type="checkbox"
            checked={categories.includes(c.key)}
            disabled={!enabled}
            onChange={(e) => toggle(c.key, e.target.checked)}
          />
          <span style={badge}>{c.letter}</span>
          <span style={{ flex: 1 }}>{c.label}</span>
          {affectedCounts && (
            <span style={{ color: affectedCounts[c.key] ? "#1c1c1c" : "#999", fontVariantNumeric: "tabular-nums" }}>
              {(affectedCounts[c.key] ?? 0).toLocaleString()}
            </span>
          )}
        </label>
      ))}
      {affectedCounts && (
        <p style={{ fontSize: "0.7rem", color: "#666", margin: "0.2rem 0 0", maxWidth: "14rem" }}>
          Counts: assets at estimated intensity VI or more, or on a damaged building. Coloured by
          intensity; no damage model for non-building assets.
        </p>
      )}
    </div>
  );
}

const badge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1rem",
  height: "1rem",
  borderRadius: "50%",
  border: "1px solid #333",
  background: "#fff",
  fontSize: "0.6rem",
  fontWeight: 700,
};
