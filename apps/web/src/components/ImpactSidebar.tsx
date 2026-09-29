import { useMemo, useState } from "react";
import { DAMAGE_COLORS, DAMAGE_STATES } from "../damageColors";
import { fmtInt, fmtMeur, impactRows, meanSeverity } from "../impactFormat";
import {
  INFRA_CATEGORIES,
  INTENSITY_COLORS,
  categoryLabel,
  countByCategory,
  fmtIntensity,
  subtypeLabel,
} from "../infrastructure";
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
  // Clears the scenario (App.tsx), not just hides the panel.
  onClose: () => void;
}

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
  onClose,
}: Props) {
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
  const infraCounts = useMemo(() => (infrastructure ? countByCategory(infrastructure) : null), [infrastructure]);
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
        width: "23rem",
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid #ddd",
        background: "#fafafa",
        minHeight: 0,
      }}
    >
      <header style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #ddd", background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
          <h2 style={{ fontSize: "1rem", margin: 0 }}>{title}</h2>
          <button onClick={onClose} title="Close scenario" aria-label="Close scenario" style={iconButton}>
            ×
          </button>
        </div>
        <p style={{ fontSize: "0.75rem", color: "#666", margin: "0.2rem 0 0" }}>{subtitle}</p>
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
        {!selectedMunicipality && infraCounts && infrastructure!.length > 0 && (
          <p style={{ fontSize: "0.8rem", color: "#555", margin: "0.25rem 0 0" }}>
            Critical infrastructure affected:{" "}
            {INFRA_CATEGORIES.filter((c) => infraCounts[c.key])
              .map((c) => `${fmtInt(infraCounts[c.key])} ${c.label.toLowerCase()}`)
              .join(" · ")}
          </p>
        )}
        {(selectedMunicipality ? (sortedSections?.length ?? 0) : affected.length) > 1 && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={selectedMunicipality ? "Search section code…" : "Search municipality or INE code…"}
            aria-label={selectedMunicipality ? "Search census sections" : "Search municipalities"}
            style={{ width: "100%", marginTop: "0.5rem", fontSize: "0.85rem" }}
          />
        )}
      </header>

      <div style={{ overflowY: "auto", padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {selectedMunicipality ? (
          <>
            <AreaCard title={selectedMunicipality.name ?? selectedMunicipality.municipality_code} area={selectedMunicipality} emphasized />
            {municipalityInfrastructure && municipalityInfrastructure.length > 0 && (
              <InfrastructureList rows={municipalityInfrastructure} />
            )}
            <h3 style={{ fontSize: "0.85rem", margin: "0.5rem 0 0" }}>
              Census sections with damage
              {sortedSections && shownSections
                ? needle
                  ? ` (${shownSections.length} of ${sortedSections.length})`
                  : ` (${sortedSections.length})`
                : ""}
            </h3>
            {sectionsError && <p style={{ color: "#c1121f", fontSize: "0.8rem" }}>{sectionsError}</p>}
            {!sectionsError && !sortedSections && <p style={{ fontSize: "0.8rem", color: "#666" }}>Loading…</p>}
            {shownSections?.length === 0 && <NoMatches query={query} />}
            {shownSections?.map((s) => (
              <AreaCard
                key={s.section_code}
                title={`Section ${sectionLabel(s.section_code)}`}
                subtitle={s.section_code}
                area={s}
                selected={s.section_code === selectedSectionCode}
                onClick={() => onSelectSection(s.section_code === selectedSectionCode ? null : s.section_code)}
              />
            ))}
          </>
        ) : (
          <>
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
                Show {Math.min(PAGE_SIZE, shownMunicipalities.length - limit)} more
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

// Enough to list a town's affected hospitals and schools without a long
// tail of bridges pushing its census sections off screen.
const INFRA_LIST_LIMIT = 25;

function InfrastructureList({ rows }: { rows: InfrastructureResult[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, INFRA_LIST_LIMIT);
  return (
    <section>
      <h3 style={{ fontSize: "0.85rem", margin: "0.5rem 0 0.3rem" }}>Critical infrastructure affected ({rows.length})</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
        {shown.map((r) => (
          <div
            key={r.asset_id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              background: "#fff",
              border: "1px solid #e2e2e2",
              borderRadius: 4,
              padding: "0.25rem 0.5rem",
              fontSize: "0.78rem",
            }}
          >
            <span
              title="Estimated intensity (EMS-98)"
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
              {fmtIntensity(r.intensity)}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.name ?? subtypeLabel(r.subtype)}
              </span>
              <span style={{ color: "#888", fontSize: "0.7rem" }}>
                {r.name ? subtypeLabel(r.subtype) : categoryLabel(r.category)}
              </span>
            </span>
            {r.damage_state_code !== null && (
              <span
                title="Damage state of its building"
                style={{
                  borderLeft: `4px solid ${DAMAGE_COLORS[DAMAGE_STATES[r.damage_state_code]]}`,
                  paddingLeft: "0.3rem",
                  color: "#555",
                }}
              >
                {DAMAGE_STATES[r.damage_state_code]}
              </span>
            )}
          </div>
        ))}
      </div>
      {rows.length > INFRA_LIST_LIMIT && (
        <button onClick={() => setExpanded((e) => !e)} style={{ ...linkButton, marginTop: "0.3rem" }}>
          {expanded ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </section>
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
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      style={{
        background: "#fff",
        border: `1px solid ${selected ? "#ff2d95" : "#e2e2e2"}`,
        borderLeft: `4px solid ${DAMAGE_COLORS[DAMAGE_STATES[damageClass(area)]]}`,
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
  return <p style={{ fontSize: "0.8rem", color: "#666" }}>No matches for “{query.trim()}”.</p>;
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
