import { useMemo, useState } from "react";
import type { FloodAreaStats, FloodMunicipalityStats, FloodResult, FloodSectionStats } from "../floodApi";
import { INFRA_CATEGORIES, categoryLabel, subtypeLabel, type InfraCategory } from "../infrastructure";
import type { InfrastructureResult } from "../scenarioApi";
import { useI18n } from "../settings";
import { floodAreaRows, shareColor } from "./floodLayers";
import { SIDEBAR_WIDTH_REM } from "./ImpactSidebar";
import { InfraIcon } from "./InfraIcon";

// Flood scenario panel (ADR-0029): the same shape as the seismic one
// (ImpactSidebar) -- affected municipalities, drill-down into their census
// sections, critical infrastructure -- with flood figures instead of
// damage/cost/debris (services/scenario/flood.py).

const PAGE_SIZE = 100;
const INFRA_PAGE_SIZE = 50;

interface Props {
  title: string;
  result: FloodResult;
  selectedMunicipality: FloodMunicipalityStats | null;
  sections: FloodSectionStats[] | null;
  sectionsError: string | null;
  selectedSectionCode: string | null;
  onSelectMunicipality: (code: string | null) => void;
  onSelectSection: (code: string | null) => void;
  infrastructure: InfrastructureResult[] | null;
  focusedAssetId: number | null;
  onSelectAsset: (asset: InfrastructureResult) => void;
  // Province code -> name, for the "not mapped" note.
  provinceNames: Map<string, string>;
  onClose: () => void;
}

export function FloodSidebar({
  title,
  result,
  selectedMunicipality,
  sections,
  sectionsError,
  selectedSectionCode,
  onSelectMunicipality,
  onSelectSection,
  infrastructure,
  focusedAssetId,
  onSelectAsset,
  provinceNames,
  onClose,
}: Props) {
  const i18n = useI18n();
  const { t, fmtInt, fmtDecimal } = i18n;
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [query, setQuery] = useState("");
  const [listIdentity, setListIdentity] = useState({ result, selectedMunicipality });
  if (listIdentity.result !== result || listIdentity.selectedMunicipality !== selectedMunicipality) {
    setListIdentity({ result, selectedMunicipality });
    setQuery("");
    setLimit(PAGE_SIZE);
  }

  const affected = useMemo(
    () => result.municipality_stats.filter((m) => m.n_flooded > 0 || m.flooded_area_km2 > 0).sort(byFlooded),
    [result]
  );
  const sortedSections = useMemo(() => (sections ? [...sections].sort(byFlooded) : null), [sections]);
  const municipalityInfrastructure = useMemo(
    () =>
      selectedMunicipality && infrastructure
        ? infrastructure.filter((r) => r.municipality_code === selectedMunicipality.municipality_code)
        : null,
    [infrastructure, selectedMunicipality]
  );

  const needle = normalize(query.trim());
  const shownMunicipalities = needle
    ? affected.filter((m) => normalize(`${m.name ?? ""} ${m.municipality_code}`).includes(needle))
    : affected;
  const shownSections = needle ? sortedSections?.filter((s) => s.section_code.includes(needle)) : sortedSections;
  const { totals } = result;
  const unmapped = result.flood.unmapped_provinces;

  return (
    <aside style={asideStyle}>
      <header style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
          <h2 style={{ fontSize: "1rem", margin: 0 }}>{title}</h2>
          <button onClick={onClose} title={t("sidebar.close")} aria-label={t("sidebar.close")} style={iconButton}>
            ×
          </button>
        </div>
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>
          {[
            t("flood.summary", {
              buildings: fmtInt(totals.n_flooded),
              people: fmtInt(totals.affected_population),
              area: fmtDecimal(totals.flooded_area_km2),
            }),
            ...(result.cached ? [t("scenario.cached")] : []),
          ].join(" · ")}
        </p>
        {unmapped.length > 0 && (
          <p style={noteStyle("var(--danger)")}>
            {t("flood.unmapped", {
              period: result.flood.return_period,
              provinces: unmapped.map((p) => provinceNames.get(p) ?? p).join(", "),
            })}
          </p>
        )}
        {selectedMunicipality ? (
          <button onClick={() => onSelectMunicipality(null)} style={linkButton}>
            {t("sidebar.allMunicipalities")}
          </button>
        ) : (
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
            {affected.length === 0 ? t("flood.noFlooding") : t("flood.municipalityCount", { count: totals.n_municipalities })}
          </p>
        )}
        {(selectedMunicipality ? (sortedSections?.length ?? 0) : affected.length) > 1 && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={selectedMunicipality ? t("sidebar.searchSections") : t("sidebar.searchMunicipalities")}
            aria-label={selectedMunicipality ? t("sidebar.searchSectionsLabel") : t("sidebar.searchMunicipalitiesLabel")}
            style={{ width: "100%", marginTop: "0.5rem", fontSize: "0.85rem" }}
          />
        )}
      </header>

      <div style={{ overflowY: "auto", padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {selectedMunicipality ? (
          <>
            <FloodAreaCard
              title={selectedMunicipality.name ?? selectedMunicipality.municipality_code}
              area={selectedMunicipality}
              emphasized
            />
            {municipalityInfrastructure && municipalityInfrastructure.length > 0 && (
              <FloodInfrastructureList
                key={selectedMunicipality.municipality_code}
                rows={municipalityInfrastructure}
                focusedAssetId={focusedAssetId}
                onSelectAsset={onSelectAsset}
              />
            )}
            <h3 style={{ fontSize: "0.85rem", margin: "0.5rem 0 0" }}>
              {t("flood.sectionsFlooded")}
              {sortedSections ? ` (${fmtInt(sortedSections.length)})` : ""}
            </h3>
            {sectionsError && <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{sectionsError}</p>}
            {!sectionsError && !sortedSections && (
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{t("common.loading")}</p>
            )}
            {shownSections?.map((s) => (
              <FloodAreaCard
                key={s.section_code}
                title={t("sidebar.section", { label: `${s.section_code.slice(5, 7)}-${s.section_code.slice(7)}` })}
                subtitle={s.section_code}
                area={s}
                selected={s.section_code === selectedSectionCode}
                onClick={() => onSelectSection(s.section_code === selectedSectionCode ? null : s.section_code)}
              />
            ))}
          </>
        ) : (
          <>
            {infrastructure && infrastructure.length > 0 && (
              <FloodInfrastructureList rows={infrastructure} focusedAssetId={focusedAssetId} onSelectAsset={onSelectAsset} />
            )}
            {shownMunicipalities.slice(0, limit).map((m) => (
              <FloodAreaCard
                key={m.municipality_code}
                title={m.name ?? m.municipality_code}
                subtitle={m.municipality_code}
                area={m}
                onClick={() => onSelectMunicipality(m.municipality_code)}
              />
            ))}
            {shownMunicipalities.length > limit && (
              <button onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                {t("sidebar.showMore", { count: Math.min(PAGE_SIZE, shownMunicipalities.length - limit) })}
              </button>
            )}
          </>
        )}
        <p style={{ fontSize: "0.7rem", color: "var(--text-subtle)" }}>
          {t(result.hazard === "coast" ? "coast.coverageNote" : "flood.coverageNote")}
        </p>
        <p style={{ fontSize: "0.7rem", color: "var(--text-subtle)", marginTop: 0 }}>
          {t(result.hazard === "coast" ? "coast.source" : "flood.source")}
        </p>
      </div>
    </aside>
  );
}

function FloodAreaCard({
  title,
  subtitle,
  area,
  onClick,
  selected = false,
  emphasized = false,
}: {
  title: string;
  subtitle?: string;
  area: FloodAreaStats;
  onClick?: () => void;
  selected?: boolean;
  emphasized?: boolean;
}) {
  const i18n = useI18n();
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      style={{
        background: "var(--surface)",
        border: `1px solid ${selected ? "var(--selected)" : "var(--border-soft)"}`,
        borderLeft: `4px solid ${shareColor(area.pct_buildings_flooded)}`,
        borderRadius: 4,
        padding: "0.5rem 0.6rem",
        cursor: onClick ? "pointer" : "default",
        boxShadow: emphasized ? "0 1px 3px var(--shadow)" : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
        <strong style={{ fontSize: "0.9rem" }}>{title}</strong>
        {subtitle && <span style={{ fontSize: "0.7rem", color: "var(--text-subtle)" }}>{subtitle}</span>}
      </div>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "0.1rem 0.6rem",
          margin: "0.35rem 0 0",
          fontSize: "0.78rem",
        }}
      >
        {floodAreaRows(area, i18n).map((row) => (
          <div key={row.label} title={row.hint} style={{ display: "contents" }}>
            <dt style={{ color: "var(--text-muted)" }}>{row.label}</dt>
            <dd style={{ margin: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function FloodInfrastructureList({
  rows,
  focusedAssetId,
  onSelectAsset,
}: {
  rows: InfrastructureResult[];
  focusedAssetId: number | null;
  onSelectAsset: (asset: InfrastructureResult) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const groups = useMemo(() => {
    const byCategory = new Map<string, InfrastructureResult[]>();
    for (const row of rows) byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row]);
    return INFRA_CATEGORIES.filter((c) => byCategory.has(c.key)).map((c) => ({
      category: c.key,
      label: categoryLabel(i18n, c.key),
      rows: byCategory.get(c.key)!,
    }));
  }, [rows, i18n]);
  return (
    <details style={sectionBox}>
      <summary style={{ cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 }}>
        {t("flood.infraTitle", { count: rows.length })}
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.4rem" }}>
        {groups.map((g) => (
          <InfraGroup
            key={g.category}
            category={g.category}
            label={g.label}
            rows={g.rows}
            focusedAssetId={focusedAssetId}
            onSelectAsset={onSelectAsset}
          />
        ))}
      </div>
    </details>
  );
}

function InfraGroup({
  category,
  label,
  rows,
  focusedAssetId,
  onSelectAsset,
}: {
  category: InfraCategory;
  label: string;
  rows: InfrastructureResult[];
  focusedAssetId: number | null;
  onSelectAsset: (asset: InfrastructureResult) => void;
}) {
  const i18n = useI18n();
  const { t, fmtInt } = i18n;
  const [limit, setLimit] = useState(INFRA_PAGE_SIZE);
  return (
    <details>
      <summary style={{ cursor: "pointer", fontSize: "0.8rem" }}>
        <InfraIcon category={category} /> {label} ({fmtInt(rows.length)})
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", margin: "0.3rem 0 0.2rem" }}>
        {rows.slice(0, limit).map((r) => (
          <button
            key={r.asset_id}
            onClick={() => onSelectAsset(r)}
            title={t("sidebar.showOnMap")}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: "var(--surface)",
              color: "var(--text)",
              border: `1px solid ${r.asset_id === focusedAssetId ? "var(--selected)" : "var(--border-soft)"}`,
              borderRadius: 4,
              padding: "0.25rem 0.5rem",
              fontSize: "0.78rem",
              cursor: "pointer",
            }}
          >
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.name ?? subtypeLabel(i18n, r.subtype)}
            </span>
            <span style={{ color: "var(--text-subtle)", fontSize: "0.7rem" }}>
              {r.name ? subtypeLabel(i18n, r.subtype) : r.municipality_code}
            </span>
          </button>
        ))}
        {rows.length > limit && (
          <button onClick={() => setLimit((n) => n + INFRA_PAGE_SIZE)} style={{ ...linkButton, marginTop: 0 }}>
            {t("sidebar.showMore", { count: Math.min(INFRA_PAGE_SIZE, rows.length - limit) })}
          </button>
        )}
      </div>
    </details>
  );
}

// Like the seismic sidebar: highest share of buildings affected first, then
// most buildings affected, then largest flooded area (areas with zone but no
// buildings in it last).
function byFlooded(a: FloodAreaStats, b: FloodAreaStats): number {
  return (
    (b.pct_buildings_flooded ?? 0) - (a.pct_buildings_flooded ?? 0) ||
    b.n_flooded - a.n_flooded ||
    b.flooded_area_km2 - a.flooded_area_km2
  );
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const asideStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  zIndex: 2,
  width: `${SIDEBAR_WIDTH_REM}rem`,
  display: "flex",
  flexDirection: "column",
  borderLeft: "1px solid var(--border)",
  boxShadow: "-2px 0 6px var(--shadow)",
  background: "var(--sunken)",
  color: "var(--text)",
  minHeight: 0,
};

const noteStyle = (color: string): React.CSSProperties => ({
  fontSize: "0.75rem",
  color,
  margin: "0.35rem 0 0",
});

const sectionBox: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border-soft)",
  borderRadius: 4,
  padding: "0.4rem 0.6rem",
};

const iconButton: React.CSSProperties = {
  border: "none",
  background: "none",
  fontSize: "1.2rem",
  lineHeight: 1,
  padding: "0 0.25rem",
  color: "var(--text)",
};

const linkButton: React.CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  marginTop: "0.35rem",
  color: "var(--link)",
  fontSize: "0.8rem",
};
