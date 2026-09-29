import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DamageMap } from "./components/DamageMap";
import { ImpactSidebar } from "./components/ImpactSidebar";
import { FaultRunForm, ManualRunForm, type ManualParams } from "./components/RunScenarioPopup";
import { PROBABILITY_LEVEL_SHORT_LABELS } from "./probabilityLevels";
import { DamageLegend } from "./components/DamageLegend";
import {
  getSectionSeverity,
  getSectionStats,
  roundCoord,
  listFaults,
  warmUpScenarioApi,
  runFaultScenario,
  runManualScenario,
  type Fault,
  type ProbabilityLevel,
  type ScenarioResult,
  type SectionStats,
} from "./scenarioApi";

// twiner shell: a full-screen map where scenarios start (a fault's popup in
// Automatic mode, a clicked point's popup in Manual mode -- MERISUR's two
// entry modes, docs/merisur.md §4.1/§5), and a right-hand scenario panel
// with the result's impact (ADR-0024). Closing the panel clears the
// scenario.
export default function App() {
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Post-scenario impact panel (ADR-0024): shown whenever there's a
  // result; lists affected municipalities, drills into one's census
  // sections.
  const [selectedMunicipalityCode, setSelectedMunicipalityCode] = useState<string | null>(null);
  const [selectedSectionCode, setSelectedSectionCode] = useState<string | null>(null);
  const [sections, setSections] = useState<SectionStats[] | null>(null);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [sectionSeverity, setSectionSeverity] = useState<Record<string, number>>({});
  // Per-scenario cache of each municipality's section rows, shared by the
  // sidebar drill-down and the map's section popups.
  const sectionCacheRef = useRef<Map<string, Promise<SectionStats[]>>>(new Map());

  const scenarioId = result?.scenario_id ?? null;
  const selectedMunicipality = useMemo(
    () => result?.municipality_stats.find((m) => m.municipality_code === selectedMunicipalityCode) ?? null,
    [result, selectedMunicipalityCode]
  );

  const selectedSection = useMemo(
    () => sections?.find((s) => s.section_code === selectedSectionCode) ?? null,
    [sections, selectedSectionCode]
  );

  const loadSectionStats = useCallback(
    (municipalityCode: string): Promise<SectionStats[]> => {
      if (!scenarioId) return Promise.resolve([]);
      let pending = sectionCacheRef.current.get(municipalityCode);
      if (!pending) {
        pending = getSectionStats(scenarioId, municipalityCode);
        // A failed fetch isn't cached, so reopening retries it.
        pending.catch(() => sectionCacheRef.current.delete(municipalityCode));
        sectionCacheRef.current.set(municipalityCode, pending);
      }
      return pending;
    },
    [scenarioId]
  );

  // New scenario (or none): reset the drill-down, fetch the map's section
  // severities.
  useEffect(() => {
    sectionCacheRef.current = new Map();
    setSelectedMunicipalityCode(null);
    setSelectedSectionCode(null);
    setSectionSeverity({});
    if (!scenarioId) return;
    let cancelled = false;
    getSectionSeverity(scenarioId)
      .then((severity) => !cancelled && setSectionSeverity(severity))
      .catch(() => {
        // The section choropleth just stays empty; municipalities still show.
      });
    return () => {
      cancelled = true;
    };
  }, [scenarioId]);

  useEffect(() => {
    setSections(null);
    setSectionsError(null);
    setSelectedSectionCode(null);
    if (!selectedMunicipalityCode) return;
    let cancelled = false;
    loadSectionStats(selectedMunicipalityCode)
      .then((rows) => !cancelled && setSections(rows))
      .catch((e) => !cancelled && setSectionsError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [selectedMunicipalityCode, loadSectionStats]);

  // Faults feed both the map's fault layer and the fault popup.
  const [faults, setFaults] = useState<Fault[] | null>(null);
  const [faultsError, setFaultsError] = useState<string | null>(null);
  const [selectedFaultId, setSelectedFaultId] = useState<string | null>(null);

  // Automatic: hover/click faults. Manual: click anywhere for a rupture
  // popup. Only this toggle changes the mode -- a map click never does.
  const [mode, setMode] = useState<"automatic" | "manual">("automatic");
  // MERISUR's probability-level selector (docs/merisur.md §4.7): shared by
  // both popups and remembered between them.
  const [probabilityLevel, setProbabilityLevel] = useState<ProbabilityLevel>("high");
  const [manualParams, setManualParams] = useState<ManualParams>({
    lat: 40.4168,
    lon: -3.7038,
    mag: 6.0,
    styleOfFaulting: "strike-slip",
    advancedEnabled: false,
    strike: 0,
    dip: 90,
    ztorKm: 5,
  });

  // The open "run scenario" popup, if any. `key` makes each open a new
  // popup (see DamageMap's runPopup prop).
  const [pending, setPending] = useState<
    | { key: number; kind: "fault"; faultId: string; lat: number; lon: number }
    | { key: number; kind: "manual"; lat: number; lon: number }
    | null
  >(null);
  const nextPopupKey = useRef(0);

  // Fetched once: every fault, no location args.
  useEffect(() => {
    listFaults()
      .then(setFaults)
      .catch((e) => setFaultsError(e instanceof Error ? e.message : String(e)));
    warmUpScenarioApi();
  }, []);

  async function runScenario(run: () => Promise<ScenarioResult>) {
    setPending(null);
    setIsRunning(true);
    setError(null);
    try {
      setResult(await run());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRunning(false);
    }
  }

  function runManual() {
    const { lat, lon, mag, styleOfFaulting, advancedEnabled, strike, dip, ztorKm } = manualParams;
    const rake = STYLE_OF_FAULTING_RAKE[styleOfFaulting];
    setSelectedFaultId(null);
    return runScenario(() =>
      runManualScenario({
        lat,
        lon,
        mag,
        rake,
        // ADR-0008: only sent when the user has opted into the advanced
        // tier -- omitting them (not just leaving them at a default value)
        // is what tells the backend to stay a point source.
        ...(advancedEnabled ? { strike, dip, ztor_km: ztorKm } : {}),
        probability_level: probabilityLevel,
      })
    );
  }

  // The clicked point is only used as the rupture's reference point for a
  // fault without full rupture geometry (see runFaultScenario).
  function runFault(fault: Fault, near: { lat: number; lon: number }) {
    setSelectedFaultId(fault.fault_id);
    return runScenario(() => runFaultScenario(fault, probabilityLevel, near));
  }

  function handleFaultClick(faultId: string, lat: number, lon: number) {
    setPending({ key: nextPopupKey.current++, kind: "fault", faultId, lat, lon });
  }

  // Manual mode only (see `mode`). Rounded here too (not just in
  // scenarioApi.ts) so the popup's lat/lon show the value that's sent.
  function handleMapClick(lat: number, lon: number) {
    if (mode !== "manual") return;
    setManualParams((p) => ({ ...p, lat: roundCoord(lat), lon: roundCoord(lon) }));
    setPending({ key: nextPopupKey.current++, kind: "manual", lat, lon });
  }

  function changeMode(next: "automatic" | "manual") {
    setMode(next);
    setPending(null);
  }

  // Closing the scenario panel clears the scenario: result layers go back
  // to their pre-scenario state (DamageMap reacts to the null result), the
  // viewport stays where it is.
  function clearScenario() {
    setResult(null);
    setSelectedFaultId(null);
    setError(null);
  }

  const pendingFault = pending?.kind === "fault" ? faults?.find((f) => f.fault_id === pending.faultId) : undefined;
  const runPopup =
    pending === null
      ? null
      : {
          key: pending.key,
          lat: pending.lat,
          lon: pending.lon,
          content:
            pending.kind === "manual" ? (
              <ManualRunForm
                params={manualParams}
                onChange={setManualParams}
                probabilityLevel={probabilityLevel}
                onProbabilityLevelChange={setProbabilityLevel}
                onRun={() => void runManual()}
                isRunning={isRunning}
              />
            ) : pendingFault ? (
              <FaultRunForm
                fault={pendingFault}
                probabilityLevel={probabilityLevel}
                onProbabilityLevelChange={setProbabilityLevel}
                onRun={() => void runFault(pendingFault, { lat: pending.lat, lon: pending.lon })}
                isRunning={isRunning}
              />
            ) : (
              <p style={{ fontSize: "0.85rem" }}>Unknown fault {pending.faultId}.</p>
            ),
        };

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh" }}>
      <main style={{ flex: 1, position: "relative" }}>
        <DamageMap
          scenarioId={scenarioId}
          municipalityStats={result?.municipality_stats ?? []}
          sectionSeverity={sectionSeverity}
          selectedMunicipality={selectedMunicipality}
          selectedSection={selectedSection}
          loadSectionStats={loadSectionStats}
          evaluatedRegion={result?.evaluated_region ?? null}
          faults={faults}
          selectedFaultId={selectedFaultId}
          mode={mode}
          onFaultClick={handleFaultClick}
          onMapClick={handleMapClick}
          runPopup={runPopup}
          onRunPopupClose={(key) => setPending((p) => (p?.key === key ? null : p))}
        />

        <div style={{ ...overlayPanel, top: "0.75rem", left: "0.75rem", maxWidth: "17rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
            <strong>twiner</strong>
            <span style={{ fontSize: "0.75rem", color: "#666" }}>Seismic scenarios — Spain</span>
          </div>
          <div role="group" aria-label="Scenario mode" style={{ display: "flex", marginTop: "0.5rem" }}>
            {(["automatic", "manual"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => changeMode(m)}
                aria-pressed={mode === m}
                style={{
                  flex: 1,
                  padding: "0.3rem 0.5rem",
                  fontSize: "0.8rem",
                  border: "1px solid #bbb",
                  background: mode === m ? "#1c1c1c" : "#fff",
                  color: mode === m ? "#fff" : "#1c1c1c",
                  borderRadius: m === "automatic" ? "4px 0 0 4px" : "0 4px 4px 0",
                }}
              >
                {m === "automatic" ? "Automatic" : "Manual"}
              </button>
            ))}
          </div>
          <p style={{ fontSize: "0.75rem", color: "#666", margin: "0.4rem 0 0" }}>
            {mode === "automatic"
              ? "Click a fault (dashed purple line) to run its maximum-magnitude earthquake."
              : "Click anywhere on the map to place an earthquake."}
          </p>
          {isRunning && <p style={{ fontSize: "0.8rem", margin: "0.4rem 0 0" }}>Running scenario…</p>}
          {error && <p style={{ fontSize: "0.8rem", color: "#c1121f", margin: "0.4rem 0 0" }}>{error}</p>}
          {faultsError && (
            <p style={{ fontSize: "0.8rem", color: "#c1121f", margin: "0.4rem 0 0" }}>Faults: {faultsError}</p>
          )}
        </div>

        <details style={{ ...overlayPanel, bottom: "1.75rem", left: "0.75rem", fontSize: "0.8rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Legend</summary>
          <div style={{ marginTop: "0.5rem" }}>
            <DamageLegend
              municipalStatsStatus={isRunning ? "loading" : result ? "ready" : "idle"}
              buildingsStatus={isRunning ? "loading" : result ? "ready" : "idle"}
              debrisStatus={isRunning ? "loading" : result ? "ready" : "idle"}
            />
          </div>
        </details>
      </main>
      {result && (
        <ImpactSidebar
          title={scenarioTitle(result, faults)}
          subtitle={
            `${result.n_evaluated.toLocaleString()} buildings evaluated, ${result.n_damaged.toLocaleString()} damaged` +
            (result.rupture.finite_rupture ? " · finite rupture plane" : "") +
            (result.cached ? " · cached" : "")
          }
          municipalities={result.municipality_stats}
          selectedMunicipality={selectedMunicipality}
          sections={sections}
          sectionsError={sectionsError}
          selectedSectionCode={selectedSectionCode}
          onSelectMunicipality={setSelectedMunicipalityCode}
          onSelectSection={setSelectedSectionCode}
          onClose={clearScenario}
        />
      )}
    </div>
  );
}

const overlayPanel: React.CSSProperties = {
  position: "absolute",
  zIndex: 1,
  background: "rgba(255,255,255,0.95)",
  borderRadius: 6,
  boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
  padding: "0.6rem 0.75rem",
};

const STYLE_OF_FAULTING_RAKE: Record<ManualParams["styleOfFaulting"], number> = {
  "strike-slip": 0,
  normal: -90,
  reverse: 90,
};

// "Alhama de Murcia (1/4) - Mmax. 6.7 - High probability" or
// "Manual - Mag. 8 - Low probability". A fault result's `source` is
// "fault:<fault_id>:<name>" (services/scenario rupture.py).
function scenarioTitle(result: ScenarioResult, faults: Fault[] | null): string {
  const probability = PROBABILITY_LEVEL_SHORT_LABELS[result.rupture.probability_level];
  const [kind, faultId, ...nameParts] = result.rupture.source.split(":");
  if (kind === "fault") {
    const fault = faults?.find((f) => f.fault_id === faultId);
    const name = fault?.name ?? (nameParts.join(":") || faultId);
    return `${name} - Mmax. ${fmtMagnitude(fault?.mmax ?? result.rupture.mag)} - ${probability}`;
  }
  return `Manual - Mag. ${fmtMagnitude(result.rupture.mag)} - ${probability}`;
}

// One decimal at most, none when whole: 6.7, 8.
function fmtMagnitude(mag: number): string {
  return String(Number(mag.toFixed(1)));
}
