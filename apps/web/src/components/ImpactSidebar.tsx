import { useMemo, useState } from "react";
import { DAMAGE_COLORS, DAMAGE_STATES } from "../damageColors";
import { impactRows, meanSeverity } from "../impactFormat";
import { INFRA_CATEGORIES, INTENSITY_COLORS, categoryLabel, fmtIntensity, subtypeLabel } from "../infrastructure";
import { useI18n } from "../settings";
import type { AreaImpact, InfrastructureResult, MunicipalityStats, SectionStats } from "../scenarioApi";

// Right-hand scenario panel (ADR-0024): shown while there's a result, lists
// every municipality with damaged buildings, and drills into one
// municipality's census sections on click (App.tsx fetches those and
// zooms the map). All figures are server-side estimates -- see
// docs/impact-estimates.md for how each is computed.

interface Props {
  // The scenario, e.g. "Alhama de Murcia (1/4) - Mmax. 6.7 - High
  // probability" (App.tsx's scenarioTitle), and a one-line summary.
  title: string;
  subtitle: string;
  municipalities: MunicipalityStats[];
  selectedMunicipality: MunicipalityStats | null;
  // null while loading; the error string if the fetch failed.
  sections: SectionStats[] | null;
  sectionsError: string | null;
  selectedSectionCode: string | null;
  onSelectMunicipality: (code: string | null) => void;
  onSelectSection: (code: string | null) => void;
  // This scenario's affected critical infrastructure (ADR-0025), most
  // intense first; null while loading or with no infrastructure data.
  infrastructure: InfrastructureResult[] | null;
  // The asset last picked from the list (highlighted), and picking one:
  // App zooms the map to it and switches its layer on.
  focusedAssetId: number | null;
  onSelectAsset: (asset: InfrastructureResult) => void;
  // Clears the scenario (App.tsx), not just hides the panel.
  onClose: () => void;
}

// The panel floats over the map's right edge rather than sitting beside
// it, so opening or closing it never resizes the map (and so never moves
// the view). DamageMap keeps its own camera moves clear of it
// (`rightInsetRem`).
export const SIDEBAR_WIDTH_REM = 23;

// Enough to cover a typical scenario at a glance without rendering
// thousands of cards for a nationwide one up front.
const PAGE_SIZE = 100;

export function ImpactSidebar({
  title,
  subtitle,
  municipalities,
  selectedMunicipality,
  sections,
  sectionsError,
  selectedSectionCode,
  onSelectMunicipality,
  onSelectSection,
  infrastructure,
  focusedAssetId,
  onSelectAsset,
  onClose,
}: Props) {
  const i18n = useI18n();
  const { t, fmtInt, fmtMeur } = i18n;
  const [limit, setLimit] = useState(PAGE_SIZE);
  // Filters whichever list is showing: municipalities (name or INE code)
  // or, drilled in, the municipality's sections (code). Cleared on every
  // switch between the two, and on a new scenario.
  const [query, setQuery] = useState("");
  // Reset during render when the list changes (React's "adjusting state
  // when a prop changes" pattern) rather than in an effect, which would
  // render the stale filter once first.
  const [listIdentity, setListIdentity] = useState({ municipalities, selectedMunicipality });
  if (listIdentity.municipalities !== municipalities || listIdentity.selectedMunicipality !== selectedMunicipality) {
    setListIdentity({ municipalities, selectedMunicipality });
    setQuery("");
    setLimit(PAGE_SIZE);
  }

  const affected = useMemo(
    () => municipalities.filter((m) => m.n_damaged > 0).sort(bySeverity),
    [municipalities]
  );
  const totals = useMemo(() => sumImpact(affected), [affected]);
  const sortedSections = useMemo(() => (sections ? [...sections].sort(bySeverity) : null), [sections]);
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
  const shownSections = needle
    ? sortedSections?.filter((s) => normalize(`${s.section_code} ${sectionLabel(s.section_code)}`).includes(needle))
    : sortedSections;

  return (
    <aside
      style={{
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
      }}
    >
      <header style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
          <h2 style={{ fontSize: "1rem", margin: 0 }}>{title}</h2>
          <button onClick={onClose} title={t("sidebar.close")} aria-label={t("sidebar.close")} style={iconButton}>
            ×
          </button>
        </div>
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>{subtitle}</p>
        {selectedMunicipality ? (
          <button onClick={() => onSelectMunicipality(null)} style={linkButton}>
            {t("sidebar.allMunicipalities")}
          </button>
        ) : (
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
            {affected.length === 0
              ? t("sidebar.noDamage")
              : t("sidebar.summary", {
                  count: affected.length,
                  affected: fmtInt(totals.affected_population),
                  displaced: fmtInt(totals.displaced_population),
                  cost: fmtMeur(totals.cost_meur),
                  debris: fmtInt(totals.debris_t),
                })}
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
            <AreaCard title={selectedMunicipality.name ?? selectedMunicipality.municipality_code} area={selectedMunicipality} emphasized />
            {municipalityInfrastructure && municipalityInfrastructure.length > 0 && (
              <InfrastructureList
                key={selectedMunicipality.municipality_code}
                rows={municipalityInfrastructure}
                focusedAssetId={focusedAssetId}
                onSelectAsset={onSelectAsset}
              />
            )}
            <h3 style={{ fontSize: "0.85rem", margin: "0.5rem 0 0" }}>
              {t("sidebar.sectionsWithDamage")}
              {sortedSections && shownSections
                ? needle
                  ? ` ${t("sidebar.countOf", { shown: shownSections.length, total: sortedSections.length })}`
                  : ` (${fmtInt(sortedSections.length)})`
                : ""}
            </h3>
            {sectionsError && <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{sectionsError}</p>}
            {!sectionsError && !sortedSections && <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{t("common.loading")}</p>}
            {shownSections?.length === 0 && <NoMatches query={query} />}
            {shownSections?.map((s) => (
              <AreaCard
                key={s.section_code}
                title={t("sidebar.section", { label: sectionLabel(s.section_code) })}
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
              <InfrastructureList
                rows={infrastructure}
                focusedAssetId={focusedAssetId}
                onSelectAsset={onSelectAsset}
              />
            )}
            {needle && shownMunicipalities.length === 0 && <NoMatches query={query} />}
            {shownMunicipalities.slice(0, limit).map((m) => (
              <AreaCard
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
        <p style={{ fontSize: "0.7rem", color: "var(--text-subtle)" }}>{t("sidebar.disclaimer")}</p>
      </div>
    </aside>
  );
}

// Rows shown per category before "Show more": a nationwide scenario can
// flag thousands of bridges.
const INFRA_PAGE_SIZE = 50;

// Affected critical infrastructure (ADR-0025), collapsed by default and
// grouped by category (each group collapsed too), most intense first
// within a group. Clicking an asset zooms the map to it.
function InfrastructureList({
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
      ...c,
      label: categoryLabel(i18n, c.key),
      rows: byCategory.get(c.key)!,
    }));
  }, [rows, i18n]);
  return (
    <details style={sectionBox}>
      <summary style={summaryStyle}>{t("sidebar.infraTitle", { count: rows.length })}</summary>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.4rem" }}>
        {groups.map((g) => (
          <InfrastructureGroup
            key={g.key}
            label={g.label}
            letter={g.letter}
            rows={g.rows}
            focusedAssetId={focusedAssetId}
            onSelectAsset={onSelectAsset}
          />
        ))}
        <p style={{ fontSize: "0.7rem", color: "var(--text-subtle)", margin: 0 }}>{t("sidebar.infraNote")}</p>
      </div>
    </details>
  );
}

function InfrastructureGroup({
  label,
  letter,
  rows,
  focusedAssetId,
  onSelectAsset,
}: {
  label: string;
  letter: string;
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
        <span style={letterBadge}>{letter}</span> {label} ({fmtInt(rows.length)})
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", margin: "0.3rem 0 0.2rem" }}>
        {rows.slice(0, limit).map((r) => (
          <button
            key={r.asset_id}
            onClick={() => onSelectAsset(r)}
            title={t("sidebar.showOnMap")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
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
            <span
              title={t("sidebar.intensityTitle")}
              style={{
                minWidth: "4.2rem",
                textAlign: "center",
                borderRadius: 3,
                padding: "0 0.25rem",
                background: INTENSITY_COLORS[Math.min(10, Math.floor(r.intensity))],
                color: r.intensity >= 9 ? "#fff" : "#1c1c1c",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtIntensity(i18n, r.intensity)}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.name ?? subtypeLabel(i18n, r.subtype)}
              </span>
              <span style={{ color: "var(--text-subtle)", fontSize: "0.7rem" }}>
                {r.name ? subtypeLabel(i18n, r.subtype) : r.municipality_code}
              </span>
            </span>
            {r.damage_state_code !== null && <DamageChip code={r.damage_state_code} probs={r.damage_probs} />}
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

// A facility's building damage: its labelled state, and the whole
// distribution as a thin bar under it (hover for the percentages).
function DamageChip({ code, probs }: { code: number; probs: number[] | null }) {
  const { t, fmtPct } = useI18n();
  const state = DAMAGE_STATES[code];
  const stateLabel = state ? t(`damage.${state}`) : "—";
  const breakdown = probs
    ? DAMAGE_STATES.map((s, i) => `${t(`damage.${s}`)} ${fmtPct((probs[i] ?? 0) * 100)}`).join(" · ")
    : stateLabel;
  return (
    <span
      title={t("sidebar.buildingDamage", { breakdown })}
      style={{ width: "4.5rem", flex: "none", color: "var(--text-muted)" }}
    >
      <span style={{ display: "block", fontSize: "0.72rem" }}>{stateLabel}</span>
      {probs && (
        <span style={{ display: "flex", height: "0.3rem", borderRadius: 1, overflow: "hidden" }}>
          {DAMAGE_STATES.map((s, i) =>
            (probs[i] ?? 0) > 0 ? <span key={s} style={{ flex: probs[i], background: DAMAGE_COLORS[s] }} /> : null
          )}
        </span>
      )}
    </span>
  );
}

const sectionBox: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border-soft)",
  borderRadius: 4,
  padding: "0.4rem 0.6rem",
};

const summaryStyle: React.CSSProperties = { cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 };

const letterBadge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "0.95rem",
  height: "0.95rem",
  borderRadius: "50%",
  border: "1px solid var(--text)",
  fontSize: "0.58rem",
  fontWeight: 700,
  verticalAlign: "middle",
};

function AreaCard({
  title,
  subtitle,
  area,
  onClick,
  selected = false,
  emphasized = false,
}: {
  title: string;
  subtitle?: string;
  area: AreaImpact;
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
        borderLeft: `4px solid ${DAMAGE_COLORS[DAMAGE_STATES[damageClass(area)]]}`,
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
      <DamageBar area={area} />
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.1rem 0.6rem", margin: 0, fontSize: "0.78rem" }}>
        {impactRows(area, i18n).map((row) => (
          <div key={row.label} title={row.hint} style={{ display: "contents" }}>
            <dt style={{ color: "var(--text-muted)" }}>{row.label}</dt>
            <dd style={{ margin: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Share of evaluated buildings in each damage state.
function DamageBar({ area }: { area: AreaImpact }) {
  const { t, fmtInt, fmtPct } = useI18n();
  const total = area.n_evaluated || 1;
  return (
    <div style={{ display: "flex", height: "0.5rem", borderRadius: 2, overflow: "hidden", margin: "0.35rem 0" }}>
      {DAMAGE_STATES.map((state) => {
        const n = area.counts[state] ?? 0;
        if (n === 0) return null;
        return (
          <div
            key={state}
            title={`${t(`damage.${state}`)}: ${fmtInt(n)} (${fmtPct((100 * n) / total)})`}
            style={{ flex: n, background: DAMAGE_COLORS[state] }}
          />
        );
      })}
    </div>
  );
}

// An area's damage class: its mean damage state (0 None .. 4 Complete)
// rounded to the nearest state -- the same class its card's left border
// is colored by, so the list order and the colors agree.
function damageClass(area: AreaImpact): number {
  return Math.min(4, Math.round(meanSeverity(area)));
}

// Worst damage class first; within a class, highest share of buildings
// affected, then most damaged buildings as a tie-break.
function bySeverity(a: AreaImpact, b: AreaImpact): number {
  return (
    damageClass(b) - damageClass(a) ||
    (b.pct_buildings_affected ?? 0) - (a.pct_buildings_affected ?? 0) ||
    b.n_damaged - a.n_damaged
  );
}

// "01-003": district-section, the part of a section code that's unique
// within its municipality.
function sectionLabel(code: string): string {
  return `${code.slice(5, 7)}-${code.slice(7)}`;
}

// Case- and accent-insensitive ("malaga" finds "Málaga").
function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function NoMatches({ query }: { query: string }) {
  const { t } = useI18n();
  return <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{t("sidebar.noMatches", { query: query.trim() })}</p>;
}

function sumImpact(areas: AreaImpact[]) {
  return areas.reduce(
    (t, a) => ({
      affected_population: t.affected_population + a.affected_population,
      displaced_population: t.displaced_population + a.displaced_population,
      cost_meur: t.cost_meur + a.cost_meur,
      debris_t: t.debris_t + a.debris_t,
    }),
    { affected_population: 0, displaced_population: 0, cost_meur: 0, debris_t: 0 }
  );
}

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
