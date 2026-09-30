import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DamageMap } from "./components/DamageMap";
import { ImpactSidebar, SIDEBAR_WIDTH_REM } from "./components/ImpactSidebar";
import { ManualRunForm, type ManualParams } from "./components/RunScenarioPopup";
import { DamageLegend } from "./components/DamageLegend";
import { RealtimePanel } from "./components/RealtimePanel";
import { useRealtimeLayer } from "./useRealtimeLayer";
import {
  AEMET_REFRESH_MS,
  AEMET_WARNINGS_REFRESH_MS,
  DEFAULT_AEMET_METRIC,
  DGT_REFRESH_MS,
  getAemetObservations,
  getAemetWarnings,
  warningWindowMs,
  getDgtIncidents,
  type AemetMetricKey,
  type WarningWindow,
  type DgtCategory,
} from "./realtime";
import { Segmented } from "./components/Segmented";
import { SettingsMenu } from "./components/SettingsMenu";
import { BasemapPicker } from "./components/BasemapPicker";
import { resolveBasemap } from "./basemaps";
import type { I18n } from "./i18n";
import { useSettings } from "./settings";
import { INFRA_CATEGORY_KEYS, type InfraCategory } from "./infrastructure";
import {
  getInfrastructure,
  getIntensityBands,
  getSectionSeverity,
  getSectionStats,
  roundCoord,
  listFaults,
  warmUpScenarioApi,
  runFaultScenario,
  runManualScenario,
  type Fault,
  type InfrastructureResult,
  type IntensityBands,
  type ProbabilityLevel,
  type ScenarioResult,
  type SectionStats,
} from "./scenarioApi";

// twiner shell: a full-screen map where scenarios start (clicking a fault
// in Automatic mode, a clicked point's popup in Manual mode -- MERISUR's
// two entry modes, docs/merisur.md §4.1/§5), and a right-hand scenario panel
// with the result's impact (ADR-0024). Closing the panel clears the
// scenario.
export default function App() {
  const { settings, theme, i18n } = useSettings();
  const basemap = resolveBasemap(settings.basemap, settings.customBasemaps, theme);
  // The map's camera, for the basemap picker's thumbnails.
  const { t } = i18n;
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

  // Map layer toggles, all in the legend: the damage layers (buildings,
  // choropleths, debris) on by default; intensity bands and critical
  // infrastructure (ADR-0025) off until asked for. Both of the latter are
  // fetched per scenario either way.
  const [showDamage, setShowDamage] = useState(true);
  const [showFaults, setShowFaults] = useState(true);
  const [intensityBands, setIntensityBands] = useState<IntensityBands | null>(null);
  const [showIntensity, setShowIntensity] = useState(false);
  const [infrastructure, setInfrastructure] = useState<InfrastructureResult[] | null>(null);
  const [infraCategories, setInfraCategories] = useState<InfraCategory[]>([]);
  // An asset picked in the sidebar: the map flies to it and opens its
  // popup. `key` makes picking the same asset again fly there again.
  const [focusedAsset, setFocusedAsset] = useState<{ key: number; asset: InfrastructureResult } | null>(null);
  const nextFocusKey = useRef(0);
  const hasInfrastructure = result?.infrastructure_summary != null;

  useEffect(() => {
    setIntensityBands(null);
    setInfrastructure(null);
    setFocusedAsset(null);
    if (!scenarioId) return;
    let cancelled = false;
    getIntensityBands(scenarioId)
      .then((bands) => !cancelled && setIntensityBands(bands))
      .catch(() => {
        // No bands (e.g. an older cached result): the toggle stays disabled.
      });
    if (hasInfrastructure) {
      getInfrastructure(scenarioId)
        .then((rows) => !cancelled && setInfrastructure(rows))
        .catch(() => {
          // Assets then just show uncoloured.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [scenarioId, hasInfrastructure]);

  // Real-time layers (ADR-0026): off until asked for, then polled while on.
  // Independent of any scenario -- "New run" leaves them as they are.
  const [realtimeOpen, setRealtimeOpen] = useState(false);
  // DGT incidents: the categories drawn (none by default), like critical
  // infrastructure's; the feed is fetched while any is on.
  const [dgtCategories, setDgtCategories] = useState<DgtCategory[]>([]);
  const showDgt = dgtCategories.length > 0;
  const [showAemet, setShowAemet] = useState(false);
  const [aemetMetric, setAemetMetric] = useState<AemetMetricKey>(DEFAULT_AEMET_METRIC);
  const dgt = useRealtimeLayer(showDgt, getDgtIncidents, DGT_REFRESH_MS);
  const aemet = useRealtimeLayer(showAemet, getAemetObservations, AEMET_REFRESH_MS);
  const [showWarnings, setShowWarnings] = useState(false);
  const [warningWindow, setWarningWindow] = useState<WarningWindow>("now");
  const warnings = useRealtimeLayer(showWarnings, getAemetWarnings, AEMET_WARNINGS_REFRESH_MS);
  // "Now" moves: the window is re-anchored every minute while warnings are
  // on, and whenever they (re)load.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!showWarnings) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [showWarnings]);
  const warningWindowRange = useMemo(
    () => warningWindowMs(warningWindow, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick and data only re-anchor Date.now()
    [warningWindow, tick, warnings.data]
  );

  // Faults feed both the map's fault layer and the fault popup.
  const [faults, setFaults] = useState<Fault[] | null>(null);
  const [faultsError, setFaultsError] = useState<string | null>(null);
  const [selectedFaultId, setSelectedFaultId] = useState<string | null>(null);

  // Automatic: hover/click faults. Manual: click anywhere for a rupture
  // popup. Only this toggle changes the mode -- a map click never does.
  const [mode, setMode] = useState<"automatic" | "manual">("automatic");
  // MERISUR's probability-level selector (docs/merisur.md §4.7), in the
  // mode panel: applies to both modes.
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

  // Manual mode's open "run scenario" popup, if any. `key` makes each
  // open a new popup (see DamageMap's runPopup prop).
  const [pending, setPending] = useState<{ key: number; lat: number; lon: number } | null>(null);
  // The legend opens on every run (and can be collapsed again).
  const [legendOpen, setLegendOpen] = useState(false);
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
    setLegendOpen(true);
    // The result itself: back on after a "New run" switched it off.
    setShowDamage(true);
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
  function runFault(fault: Pick<Fault, "fault_id" | "has_rupture_geometry">, near: { lat: number; lon: number }) {
    setSelectedFaultId(fault.fault_id);
    return runScenario(() => runFaultScenario(fault, probabilityLevel, near));
  }

  // Automatic mode: clicking a fault runs it at the selected probability
  // level straight away (hovering shows its name and Mmax, DamageMap).
  function handleFaultClick(faultId: string, lat: number, lon: number) {
    if (isRunning) return;
    const fault = faults?.find((f) => f.fault_id === faultId) ?? {
      fault_id: faultId,
      has_rupture_geometry: false,
    };
    void runFault(fault, { lat, lon });
  }

  // Manual mode only (see `mode`). Rounded here too (not just in
  // scenarioApi.ts) so the popup's lat/lon show the value that's sent.
  function handleMapClick(lat: number, lon: number) {
    if (mode !== "manual") return;
    setManualParams((p) => ({ ...p, lat: roundCoord(lat), lon: roundCoord(lon) }));
    setPending({ key: nextPopupKey.current++, lat, lon });
  }

  function changeMode(next: "automatic" | "manual") {
    setMode(next);
    setPending(null);
  }

  // Closing the scenario panel clears the scenario: result layers go back
  // to their pre-scenario state (DamageMap reacts to the null result), the
  // viewport stays where it is.
  // "New run" (top-left) and the scenario panel's × both land here: back to
  // picking a scenario, with the legend collapsed and every layer toggle
  // off except faults (on, since Automatic mode starts from them). The next
  // run switches damage back on itself.
  function clearScenario() {
    setResult(null);
    setSelectedFaultId(null);
    setError(null);
    setLegendOpen(false);
    setShowDamage(false);
    setShowIntensity(false);
    setInfraCategories([]);
    setShowFaults(true);
  }

  // Sidebar asset click: switch its category's layer on (the legend shows
  // it on too) and fly the map to it.
  function focusAsset(asset: InfrastructureResult) {
    const category = asset.category as InfraCategory;
    setInfraCategories((current) =>
      current.includes(category) ? current : INFRA_CATEGORY_KEYS.filter((k) => k === category || current.includes(k))
    );
    setFocusedAsset({ key: nextFocusKey.current++, asset });
  }

  const runPopup =
    pending === null
      ? null
      : {
          ...pending,
          content: (
            <ManualRunForm
              params={manualParams}
              onChange={setManualParams}
              onRun={() => void runManual()}
              isRunning={isRunning}
            />
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
          showFaults={showFaults}
          showDamage={showDamage}
          intensityBands={intensityBands}
          showIntensity={showIntensity}
          infrastructureCategories={infraCategories}
          infrastructureResults={infrastructure}
          focusedAsset={focusedAsset}
          dgtIncidents={showDgt ? dgt.data : null}
          dgtCategories={dgtCategories}
          aemetObservations={showAemet ? aemet.data : null}
          aemetMetric={aemetMetric}
          aemetWarnings={showWarnings ? warnings.data : null}
          warningWindow={warningWindowRange}
          rightInsetRem={result ? SIDEBAR_WIDTH_REM : 0}
          basemap={basemap}
          theme={theme}
          i18n={i18n}
          showZoom={settings.showZoom}
        />

        <SettingsMenu style={{ top: "0.75rem", right: `${(result ? SIDEBAR_WIDTH_REM : 0) + 0.75}rem` }} />
        {/* Clear of MapLibre's attribution ("i") control in the corner. */}
        <BasemapPicker style={{ bottom: "3rem", right: `${(result ? SIDEBAR_WIDTH_REM : 0) + 0.75}rem` }} />

        <div style={{ ...overlayPanel, top: "0.75rem", left: "0.75rem", maxWidth: "17rem" }}>
          {result ? (
            // With a scenario showing, the setup controls step aside: one
            // way back to them (clearScenario).
            <button
              type="button"
              onClick={clearScenario}
              style={{
                padding: "0.35rem 0.8rem",
                fontSize: "0.85rem",
                fontWeight: 600,
                border: "1px solid var(--accent-bg)",
                borderRadius: 4,
                background: "var(--accent-bg)",
                color: "var(--accent-fg)",
                cursor: "pointer",
              }}
            >
              {t("app.newRun")}
            </button>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
                <strong>twiner</strong>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{t("app.tagline")}</span>
              </div>
              <div style={{ marginTop: "0.5rem" }}>
                <Segmented
                  label={t("mode.label")}
                  value={mode}
                  options={[
                    { value: "automatic", label: t("mode.automatic") },
                    { value: "manual", label: t("mode.manual") },
                  ]}
                  onChange={changeMode}
                />
              </div>
              <label style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
                {t("probability.label")}
                <select
                  value={probabilityLevel}
                  onChange={(e) => setProbabilityLevel(e.target.value as ProbabilityLevel)}
                  style={{ fontSize: "0.8rem" }}
                >
                  {PROBABILITY_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {t(`probability.${level}`)}
                    </option>
                  ))}
                </select>
              </label>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.4rem 0 0" }}>
                {mode === "automatic"
                  ? showFaults
                    ? t("mode.hintAutomatic")
                    : t("mode.hintFaultsOff")
                  : t("mode.hintManual")}
              </p>
            </>
          )}
          {isRunning && <p style={{ fontSize: "0.8rem", margin: "0.4rem 0 0" }}>{t("app.running")}</p>}
          {error && <p style={{ fontSize: "0.8rem", color: "var(--danger)", margin: "0.4rem 0 0" }}>{error}</p>}
          {faultsError && (
            <p style={{ fontSize: "0.8rem", color: "var(--danger)", margin: "0.4rem 0 0" }}>
              {t("app.faultsError", { message: faultsError })}
            </p>
          )}
        </div>

        {/* Bottom-left stack: Real time above the Legend, both collapsible,
            sharing the height left under the mode panel. */}
        <div
          style={{
            position: "absolute",
            zIndex: 1,
            bottom: "1.75rem",
            left: "0.75rem",
            maxHeight: "calc(100vh - 12rem)",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "0.5rem",
          }}
        >
          <details open={realtimeOpen} onToggle={(e) => setRealtimeOpen(e.currentTarget.open)} style={stackedPanel}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>{t("realtime.title")}</summary>
            <div style={{ marginTop: "0.5rem" }}>
              <RealtimePanel
                dgt={dgt}
                dgtCategories={dgtCategories}
                onDgtCategoriesChange={setDgtCategories}
                aemet={aemet}
                showAemet={showAemet}
                onShowAemetChange={setShowAemet}
                aemetMetric={aemetMetric}
                onAemetMetricChange={setAemetMetric}
                warnings={warnings}
                showWarnings={showWarnings}
                onShowWarningsChange={setShowWarnings}
                warningWindow={warningWindow}
                onWarningWindowChange={setWarningWindow}
                warningWindowRange={warningWindowRange}
              />
            </div>
          </details>
          <details
            open={legendOpen}
            onToggle={(e) => setLegendOpen(e.currentTarget.open)}
            style={stackedPanel}
          >
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>{t("legend.title")}</summary>
            <div style={{ marginTop: "0.5rem" }}>
              <DamageLegend
                showFaults={showFaults}
                onShowFaultsChange={setShowFaults}
                damageStatus={isRunning ? "loading" : result ? "ready" : "idle"}
                showDamage={showDamage}
                onShowDamageChange={setShowDamage}
                intensityStatus={isRunning ? "loading" : intensityBands ? "ready" : "idle"}
                showIntensity={showIntensity}
                onShowIntensityChange={setShowIntensity}
                infraCategories={infraCategories}
                onInfraCategoriesChange={setInfraCategories}
                infraCounts={result?.infrastructure_summary ?? null}
              />
            </div>
          </details>
        </div>
        {result && (
          <ImpactSidebar
            title={scenarioTitle(result, faults, i18n)}
            subtitle={[
              t("scenario.summary", {
                evaluated: i18n.fmtInt(result.n_evaluated),
                damaged: i18n.fmtInt(result.n_damaged),
              }),
              ...(result.rupture.finite_rupture ? [t("scenario.finiteRupture")] : []),
              ...(result.cached ? [t("scenario.cached")] : []),
            ].join(" · ")}
            municipalities={result.municipality_stats}
            selectedMunicipality={selectedMunicipality}
            sections={sections}
            sectionsError={sectionsError}
            selectedSectionCode={selectedSectionCode}
            onSelectMunicipality={setSelectedMunicipalityCode}
            onSelectSection={setSelectedSectionCode}
            infrastructure={infrastructure}
            focusedAssetId={focusedAsset?.asset.asset_id ?? null}
            onSelectAsset={focusAsset}
            onClose={clearScenario}
          />
        )}
      </main>
    </div>
  );
}

const overlayPanel: React.CSSProperties = {
  position: "absolute",
  zIndex: 1,
  background: "var(--panel-bg)",
  color: "var(--text)",
  borderRadius: 6,
  boxShadow: "0 1px 4px var(--shadow)",
  padding: "0.6rem 0.75rem",
};

// One of the bottom-left collapsible panels: in the stack's flow (not
// absolutely placed), scrolling on its own when the two don't fit.
const stackedPanel: React.CSSProperties = {
  ...overlayPanel,
  position: "static",
  fontSize: "0.8rem",
  minHeight: 0,
  overflowY: "auto",
};

const STYLE_OF_FAULTING_RAKE: Record<ManualParams["styleOfFaulting"], number> = {
  "strike-slip": 0,
  normal: -90,
  reverse: 90,
};

// MERISUR's three tiers (docs/merisur.md §4.7), in selector order.
const PROBABILITY_LEVELS: ProbabilityLevel[] = ["high", "low", "very_low"];

// "Alhama de Murcia (1/4) - Mmax. 6.7 - High probability" or
// "Manual - Mag. 8 - Low probability". A fault result's `source` is
// "fault:<fault_id>:<name>" (services/scenario rupture.py). Magnitudes get
// one decimal at most, none when whole (t formats them per locale).
function scenarioTitle(result: ScenarioResult, faults: Fault[] | null, { t }: I18n): string {
  const probability = t(`probability.short.${result.rupture.probability_level}`);
  const [kind, faultId, ...nameParts] = result.rupture.source.split(":");
  if (kind === "fault") {
    const fault = faults?.find((f) => f.fault_id === faultId);
    const name = fault?.name ?? (nameParts.join(":") || faultId);
    return t("scenario.titleFault", { name, mag: roundMagnitude(fault?.mmax ?? result.rupture.mag), probability });
  }
  return t("scenario.titleManual", { mag: roundMagnitude(result.rupture.mag), probability });
}

function roundMagnitude(mag: number): number {
  return Number(mag.toFixed(1));
}
