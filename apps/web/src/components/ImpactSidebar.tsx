import { useMemo, useState } from "react";
import { DAMAGE_COLORS, DAMAGE_STATES } from "../damageColors";
import { fmtInt, fmtMeur, impactRows, meanSeverity } from "../impactFormat";
import type { AreaImpact, MunicipalityStats, SectionStats } from "../scenarioApi";

// Right-hand impact panel (ADR-0024): opens once a scenario has run, lists
// every municipality with damaged buildings, and drills into one
// municipality's census sections on click (App.tsx fetches those and
// zooms the map). All figures are server-side estimates -- see
// docs/impact-estimates.md for how each is computed.

interface Props {
  municipalities: MunicipalityStats[];
  selectedMunicipality: MunicipalityStats | null;
  // null while loading; the error string if the fetch failed.
  sections: SectionStats[] | null;
  sectionsError: string | null;
  selectedSectionCode: string | null;
  onSelectMunicipality: (code: string | null) => void;
  onSelectSection: (code: string | null) => void;
  onClose: () => void;
}

// Enough to cover a typical scenario at a glance without rendering
// thousands of cards for a nationwide one up front.
const PAGE_SIZE = 100;

export function ImpactSidebar({
  municipalities,
  selectedMunicipality,
  sections,
  sectionsError,
  selectedSectionCode,
  onSelectMunicipality,
  onSelectSection,
  onClose,
}: Props) {
  const [limit, setLimit] = useState(PAGE_SIZE);

  const affected = useMemo(
    () => municipalities.filter((m) => m.n_damaged > 0).sort(byImpact),
    [municipalities]
  );
  const totals = useMemo(() => sumImpact(affected), [affected]);
  const sortedSections = useMemo(() => (sections ? [...sections].sort(byImpact) : null), [sections]);

  return (
    <aside
      style={{
        width: "23rem",
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid #ddd",
        background: "#fafafa",
        minHeight: 0,
      }}
    >
      <header style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #ddd", background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1rem", margin: 0 }}>Impact</h2>
          <button onClick={onClose} title="Hide panel" style={iconButton}>
            ×
          </button>
        </div>
        {selectedMunicipality ? (
          <button onClick={() => onSelectMunicipality(null)} style={linkButton}>
            ← All municipalities
          </button>
        ) : (
          <p style={{ fontSize: "0.8rem", color: "#555", margin: "0.35rem 0 0" }}>
            {affected.length === 0
              ? "No municipality has damaged buildings in this scenario."
              : `${fmtInt(affected.length)} municipalities affected · ${fmtInt(totals.affected_population)} residents affected, ${fmtInt(totals.displaced_population)} displaced · ${fmtMeur(totals.cost_meur)} · ${fmtInt(totals.debris_t)} t debris`}
          </p>
        )}
      </header>

      <div style={{ overflowY: "auto", padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {selectedMunicipality ? (
          <>
            <AreaCard title={selectedMunicipality.name ?? selectedMunicipality.municipality_code} area={selectedMunicipality} emphasized />
            <h3 style={{ fontSize: "0.85rem", margin: "0.5rem 0 0" }}>
              Census sections with damage{sortedSections ? ` (${sortedSections.length})` : ""}
            </h3>
            {sectionsError && <p style={{ color: "#c1121f", fontSize: "0.8rem" }}>{sectionsError}</p>}
            {!sectionsError && !sortedSections && <p style={{ fontSize: "0.8rem", color: "#666" }}>Loading…</p>}
            {sortedSections?.map((s) => (
              <AreaCard
                key={s.section_code}
                title={`Section ${s.section_code.slice(5, 7)}-${s.section_code.slice(7)}`}
                subtitle={s.section_code}
                area={s}
                selected={s.section_code === selectedSectionCode}
                onClick={() => onSelectSection(s.section_code === selectedSectionCode ? null : s.section_code)}
              />
            ))}
          </>
        ) : (
          <>
            {affected.slice(0, limit).map((m) => (
              <AreaCard
                key={m.municipality_code}
                title={m.name ?? m.municipality_code}
                subtitle={m.municipality_code}
                area={m}
                onClick={() => onSelectMunicipality(m.municipality_code)}
              />
            ))}
            {affected.length > limit && (
              <button onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, affected.length - limit)} more
              </button>
            )}
          </>
        )}
        <p style={{ fontSize: "0.7rem", color: "#888" }}>
          Rough estimates from placeholder parameters -- hover a figure for how it's computed.
        </p>
      </div>
    </aside>
  );
}

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
  const severity = meanSeverity(area);
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      style={{
        background: "#fff",
        border: `1px solid ${selected ? "#ff2d95" : "#e2e2e2"}`,
        borderLeft: `4px solid ${DAMAGE_COLORS[DAMAGE_STATES[Math.min(4, Math.round(severity))]]}`,
        borderRadius: 4,
        padding: "0.5rem 0.6rem",
        cursor: onClick ? "pointer" : "default",
        boxShadow: emphasized ? "0 1px 3px rgba(0,0,0,0.12)" : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
        <strong style={{ fontSize: "0.9rem" }}>{title}</strong>
        {subtitle && <span style={{ fontSize: "0.7rem", color: "#888" }}>{subtitle}</span>}
      </div>
      <DamageBar area={area} />
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.1rem 0.6rem", margin: 0, fontSize: "0.78rem" }}>
        {impactRows(area).map((row) => (
          <div key={row.label} title={row.hint} style={{ display: "contents" }}>
            <dt style={{ color: "#666" }}>{row.label}</dt>
            <dd style={{ margin: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Share of evaluated buildings in each damage state.
function DamageBar({ area }: { area: AreaImpact }) {
  const total = area.n_evaluated || 1;
  return (
    <div style={{ display: "flex", height: "0.5rem", borderRadius: 2, overflow: "hidden", margin: "0.35rem 0" }}>
      {DAMAGE_STATES.map((state) => {
        const n = area.counts[state] ?? 0;
        if (n === 0) return null;
        return (
          <div
            key={state}
            title={`${state}: ${fmtInt(n)} (${((100 * n) / total).toFixed(1)}%)`}
            style={{ flex: n, background: DAMAGE_COLORS[state] }}
          />
        );
      })}
    </div>
  );
}

// Most affected residents first, then most damaged buildings.
function byImpact(a: AreaImpact, b: AreaImpact): number {
  return b.affected_population - a.affected_population || b.n_damaged - a.n_damaged;
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
};

const linkButton: React.CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  marginTop: "0.35rem",
  color: "#1c64f2",
  fontSize: "0.8rem",
};
