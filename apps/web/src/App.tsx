import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DamageMap } from "./components/DamageMap";
import { ImpactSidebar, SIDEBAR_WIDTH_REM } from "./components/ImpactSidebar";
import { ManualRunForm, type ManualParams } from "./components/RunScenarioPopup";
import { DamageLegend } from "./components/DamageLegend";
import { FloodLegend, FloodShareKey } from "./components/FloodLegend";
import { FloodPanel, type RegionMode } from "./components/FloodPanel";
import { FloodSidebar } from "./components/FloodSidebar";
import { HazardCard } from "./components/HazardCard";
import { HAZARD_COLORS } from "./damageColors";
import type { FloodMapProps } from "./components/DamageMap";
import type { FloodLayerToggles, FloodMapScenario } from "./components/floodLayers";
import {
  getFloodInfrastructure,
  getFloodSectionShares,
  getFloodSectionStats,
  KIND_RETURN_PERIODS,
  loadAdminIndex,
  loadCoverage,
  runFloodScenario,
  type AdminArea,
  type AdminLevel,
  type FloodCoverage,
  type FloodKind,
  type FloodRegion,
  type FloodResult,
  type FloodSectionStats,
  type ReturnPeriod,
} from "./floodApi";
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
import type { I18n, Language, TranslationKey } from "./i18n";
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
  DEFAULT_DAMAGE_METHOD,
  FALLBACK_METHODS,
  damageMethodParams,
  listMethods,
  methodKey,
  type DamageMethod,
  type DamageMethodParams,
  type MethodsCatalog,
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
  // On with twinQUAKE (open at first); off whenever it isn't the hazard.
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

  // Flood modes (river ADR-0029, coastal ADR-0037): their own setup, result
  // and drill-down, next to the seismic ones, shared by twinFLOOD and
  // twinCOAST (`floodKind` says which). `hazard` is the card in use
  // (twinQUAKE / twinFLOOD / twinCOAST, none at first); switching it clears
  // every result. `cardOpen`: its setup controls are showing (a run
  // collapses them).
  // twinQUAKE starts open, so the map opens on something (its faults) that
  // matches the legend.
  const [hazard, setHazard] = useState<HazardCardId | null>("seismic");
  const floodKind: FloodKind | null = hazard === "flood" || hazard === "coast" ? hazard : null;
  const [cardOpen, setCardOpen] = useState(true);
  // The choropleths' level at the current zoom, for the legend's title.
  const [areaLevel, setAreaLevel] = useState<"municipality" | "section">("municipality");
  const [returnPeriod, setReturnPeriod] = useState<ReturnPeriod>(100);
  const [regionMode, setRegionMode] = useState<RegionMode>("circle");
  const [floodResult, setFloodResult] = useState<FloodResult | null>(null);
  const [floodLayers, setFloodLayers] = useState<FloodLayerToggles>({ zones: true, buildings: true, areas: true });
  // "Zonas afectadas" (the legend): municipality/section choropleths, both hazards.
  const showAreas = floodLayers.areas;
  const setShowAreas = (areas: boolean) => setFloodLayers((l) => ({ ...l, areas }));
  const [adminIndex, setAdminIndex] = useState<AdminArea[] | null>(null);
  const [floodSectionShares, setFloodSectionShares] = useState<Record<string, number>>({});
  const [floodInfrastructure, setFloodInfrastructure] = useState<InfrastructureResult[] | null>(null);
  const [floodMunicipalityCode, setFloodMunicipalityCode] = useState<string | null>(null);
  const [floodSectionCode, setFloodSectionCode] = useState<string | null>(null);
  const [floodSections, setFloodSections] = useState<FloodSectionStats[] | null>(null);
  const [floodSectionsError, setFloodSectionsError] = useState<string | null>(null);
  const floodSectionCacheRef = useRef<Map<string, Promise<FloodSectionStats[]>>>(new Map());
  const floodScenarioId = floodResult?.scenario_id ?? null;
  // twinCOAST's areas (null: river flooding lists them all, or loading).
  const [coverage, setCoverage] = useState<FloodCoverage | null>(null);

  useEffect(() => {
    if (floodKind === null || adminIndex) return;
    loadAdminIndex()
      .then(setAdminIndex)
      .catch(() => {
        // FloodPanel shows the error; CCAA outlines on the map just can't
        // be filtered to their provinces.
      });
  }, [floodKind, adminIndex]);

  useEffect(() => {
    setCoverage(null);
    if (floodKind === null) return;
    let cancelled = false;
    loadCoverage(floodKind)
      .then((cov) => !cancelled && setCoverage(cov))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [floodKind]);

  const loadFloodSectionStats = useCallback(
    (municipalityCode: string): Promise<FloodSectionStats[]> => {
      if (!floodScenarioId) return Promise.resolve([]);
      let pending = floodSectionCacheRef.current.get(municipalityCode);
      if (!pending) {
        pending = getFloodSectionStats(floodScenarioId, municipalityCode);
        pending.catch(() => floodSectionCacheRef.current.delete(municipalityCode));
        floodSectionCacheRef.current.set(municipalityCode, pending);
      }
      return pending;
    },
    [floodScenarioId]
  );

  useEffect(() => {
    floodSectionCacheRef.current = new Map();
    setFloodMunicipalityCode(null);
    setFloodSectionCode(null);
    setFloodSectionShares({});
    setFloodInfrastructure(null);
    if (!floodScenarioId) return;
    let cancelled = false;
    getFloodSectionShares(floodScenarioId)
      .then((shares) => !cancelled && setFloodSectionShares(shares))
      .catch(() => {});
    if (floodResult?.infrastructure_summary) {
      const rp = floodResult.flood.return_period;
      getFloodInfrastructure(floodScenarioId)
        .then(
          (rows) =>
            !cancelled &&
            // The seismic row shape the map's asset layers read: flagged
            // (intensity set), no damage.
            setFloodInfrastructure(
              rows.map((r) => ({ ...r, intensity: 0, damage_state_code: null, damage_probs: null, flood_return_period: rp }))
            )
        )
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the scenario id
  }, [floodScenarioId]);

  useEffect(() => {
    setFloodSections(null);
    setFloodSectionsError(null);
    setFloodSectionCode(null);
    if (!floodMunicipalityCode) return;
    let cancelled = false;
    loadFloodSectionStats(floodMunicipalityCode)
      .then((rows) => !cancelled && setFloodSections(rows))
      .catch((e) => !cancelled && setFloodSectionsError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [floodMunicipalityCode, loadFloodSectionStats]);

  // Critical infrastructure switches on with every run (every category, off
  // again on clear), but only once the run's own asset rows have loaded:
  // before that every asset in Spain draws as a full marker, which is
  // overwhelming until the affected/greyed-out styling applies.
  const showInfraOnLoadRef = useRef(false);
  const scenarioInfrastructure = floodKind ? floodInfrastructure : infrastructure;
  useEffect(() => {
    if (!scenarioInfrastructure || !showInfraOnLoadRef.current) return;
    showInfraOnLoadRef.current = false;
    setInfraCategories(INFRA_CATEGORY_KEYS);
  }, [scenarioInfrastructure]);

  const floodMunicipality = useMemo(
    () => floodResult?.municipality_stats.find((m) => m.municipality_code === floodMunicipalityCode) ?? null,
    [floodResult, floodMunicipalityCode]
  );
  const floodSection = useMemo(
    () => floodSections?.find((s) => s.section_code === floodSectionCode) ?? null,
    [floodSections, floodSectionCode]
  );
  const provinceNames = useMemo(
    () => new Map((adminIndex ?? []).filter((a) => a.level === "province").map((a) => [a.code, a.name])),
    [adminIndex]
  );

  const floodMapScenario = useMemo((): FloodMapScenario | null => {
    if (!floodResult) return null;
    const { region, return_period } = floodResult.flood;
    const provinces =
      region.type === "admin" && region.level === "ccaa"
        ? (adminIndex ?? []).filter((a) => a.level === "province" && a.parent === region.code).map((a) => a.code)
        : [];
    return {
      kind: floodResult.hazard,
      returnPeriod: return_period,
      region,
      provinces,
      municipalityShares: Object.fromEntries(
        floodResult.municipality_stats
          .filter((m) => m.n_flooded > 0)
          .map((m) => [m.municipality_code, m.pct_buildings_flooded ?? 0])
      ),
      sectionShares: floodSectionShares,
    };
  }, [floodResult, adminIndex, floodSectionShares]);

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
  const [damageMethod, setDamageMethod] = useState<DamageMethod>(DEFAULT_DAMAGE_METHOD);
  // GET /methods (ADR-0033/0035): the valid damage model / database /
  // classification combinations. FALLBACK_METHODS until it answers.
  const [methodsCatalog, setMethodsCatalog] = useState<MethodsCatalog | null>(null);
  const methodOptions = methodsCatalog?.compatible ?? FALLBACK_METHODS;
  const defaultMethod = methodsCatalog ? methodKey(methodsCatalog.default) : DEFAULT_DAMAGE_METHOD;
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
    listMethods()
      .then(setMethodsCatalog)
      .catch(() => {}); // keep FALLBACK_METHODS
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
      setCardOpen(false);
      showInfraOnLoadRef.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRunning(false);
    }
  }

  async function runFlood(region: FloodRegion) {
    setLegendOpen(true);
    setFloodLayers({ zones: true, buildings: true, areas: true });
    setIsRunning(true);
    setError(null);
    try {
      if (!floodKind) return;
      setFloodResult(await runFloodScenario(floodKind, returnPeriod, region));
      setCardOpen(false);
      showInfraOnLoadRef.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRunning(false);
    }
  }

  // An area picked in the search box: its level becomes the picker's, and
  // it runs straight away, like clicking it on the map.
  function pickFloodArea(area: AdminArea) {
    if (isRunning) return;
    setRegionMode(area.level);
    void runFlood({ type: "admin", level: area.level, code: area.code });
  }

  function clearFlood() {
    setFloodResult(null);
    showInfraOnLoadRef.current = false;
    setInfraCategories([]);
    setError(null);
    setLegendOpen(false);
  }

  function changeHazard(next: HazardCardId | null) {
    clearScenario();
    clearFlood();
    setHazard(next);
    // Coastal maps only exist for T100/T500.
    if (next === "flood" || next === "coast") {
      const periods = KIND_RETURN_PERIODS[next];
      if (!periods.includes(returnPeriod)) setReturnPeriod(periods[0]);
    }
    setPending(null);
    // Faults are the seismic mode's own layer.
    setShowFaults(next === "seismic");
  }

  // A card's name was clicked: open that hazard (closing the other), start
  // a new run if its result is showing, or else open/close its setup
  // (closing it leaves no hazard on the map).
  function onCardClick(card: HazardCardId) {
    if (isRunning) return;
    if (hazard !== card) {
      changeHazard(card);
      setCardOpen(true);
      // The flood zones show from the start (Spain-wide, at the selected
      // return period) so the map isn't empty before a run.
      if (card !== "seismic") setFloodLayers((l) => ({ ...l, zones: true }));
    } else if (hasSidebar) {
      if (card !== "seismic") clearFlood();
      else clearScenario();
      setCardOpen(true);
    } else if (cardOpen) {
      setCardOpen(false);
      changeHazard(null);
    } else {
      setCardOpen(true);
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
        ...damageMethodParams(damageMethod, defaultMethod),
      })
    );
  }

  // The clicked point is only used as the rupture's reference point for a
  // fault without full rupture geometry (see runFaultScenario).
  function runFault(fault: Pick<Fault, "fault_id" | "has_rupture_geometry">, near: { lat: number; lon: number }) {
    setSelectedFaultId(fault.fault_id);
    return runScenario(() => runFaultScenario(fault, probabilityLevel, near, damageMethodParams(damageMethod, defaultMethod)));
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
    showInfraOnLoadRef.current = false;
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

  const floodMapProps: FloodMapProps | null =
    floodKind
      ? {
          kind: floodKind,
          coverage,
          picker: floodResult || isRunning ? null : regionMode === "circle" ? { kind: "circle" } : { kind: "admin", level: regionMode },
          scenario: floodMapScenario,
          preview: floodResult ? null : { kind: floodKind, returnPeriod },
          bbox: floodResult?.region_bbox ?? null,
          show: floodLayers,
          municipalityStats: floodResult?.municipality_stats ?? [],
          loadSectionStats: loadFloodSectionStats,
          onCircle: (circle) => {
            if (!isRunning) void runFlood(circle);
          },
          onAdminPick: (level: AdminLevel, code: string) => {
            if (!isRunning) void runFlood({ type: "admin", level, code });
          },
        }
      : null;
  const hasSidebar = floodKind ? floodResult !== null : result !== null;

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
          selectedMunicipality={floodKind ? floodMunicipality : selectedMunicipality}
          selectedSection={floodKind ? floodSection : selectedSection}
          loadSectionStats={loadSectionStats}
          evaluatedRegion={result?.evaluated_region ?? null}
          faults={faults}
          selectedFaultId={selectedFaultId}
          mode={floodKind ? "flood" : hazard === "seismic" ? mode : "none"}
          flood={floodMapProps}
          onAreaLevelChange={setAreaLevel}
          onFaultClick={handleFaultClick}
          onMapClick={handleMapClick}
          runPopup={runPopup}
          onRunPopupClose={(key) => setPending((p) => (p?.key === key ? null : p))}
          showFaults={showFaults}
          showDamage={showDamage}
          showAreas={showAreas}
          intensityBands={intensityBands}
          showIntensity={showIntensity}
          infrastructureCategories={infraCategories}
          infrastructureResults={floodKind ? floodInfrastructure : infrastructure}
          focusedAsset={focusedAsset}
          dgtIncidents={showDgt ? dgt.data : null}
          dgtCategories={dgtCategories}
          aemetObservations={showAemet ? aemet.data : null}
          aemetMetric={aemetMetric}
          aemetWarnings={showWarnings ? warnings.data : null}
          warningWindow={warningWindowRange}
          rightInsetRem={hasSidebar ? SIDEBAR_WIDTH_REM : 0}
          basemap={basemap}
          theme={theme}
          i18n={i18n}
          showZoom={settings.showZoom}
        />

        <SettingsMenu style={{ top: "0.75rem", right: `${(hasSidebar ? SIDEBAR_WIDTH_REM : 0) + 0.75}rem` }} />
        {/* Clear of MapLibre's attribution ("i") control in the corner. */}
        <BasemapPicker style={{ bottom: "3rem", right: `${(hasSidebar ? SIDEBAR_WIDTH_REM : 0) + 0.75}rem` }} />

        {/* The hazard cards (twinQUAKE, twinFLOOD, twinCOAST), collapsed at first;
            a card's name opens it (see onCardClick). */}
        <div
          style={{
            position: "absolute",
            zIndex: 1,
            top: "0.75rem",
            left: "0.75rem",
            width: LEFT_COLUMN_WIDTH,
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          {HAZARD_CARDS.map((card) => {
            const active = hazard === card;
            const open = active && cardOpen;
            const errorStyle: React.CSSProperties = {
              fontSize: "0.8rem",
              margin: "0.4rem 0 0",
              color: "var(--danger)",
            };
            const errors = [error, card === "seismic" && faultsError ? t("app.faultsError", { message: faultsError }) : null]
              .filter((e): e is string => !!e);
            const status = active && (isRunning || errors.length > 0) && (
              <>
                {isRunning && <p style={{ fontSize: "0.8rem", margin: "0.4rem 0 0" }}>{t("app.running")}</p>}
                {errors.map((e) => (
                  <p key={e} style={errorStyle}>
                    {e}
                  </p>
                ))}
              </>
            );
            return (
              <HazardCard
                key={card}
                name={CARD_NAMES[card]}
                color={HAZARD_COLORS[theme][card]}
                open={open}
                title={
                  active && hasSidebar
                    ? t("app.newRun")
                    : t(CARD_TITLES[card])
                }
                onHeaderClick={() => onCardClick(card)}
                docsHref={hazardDocsHref(card, settings.language)}
                docsLabel={t("card.docs")}
                status={status}
              >
                {card !== "seismic" ? (
                  <FloodPanel
                    kind={card}
                    coverage={coverage}
                    returnPeriod={returnPeriod}
                    onReturnPeriodChange={setReturnPeriod}
                    regionMode={regionMode}
                    onRegionModeChange={setRegionMode}
                    onPickArea={pickFloodArea}
                    disabled={isRunning}
                  />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column" }}>
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
                    <label style={{ marginTop: "0.5rem", fontSize: "0.8rem" }} title={t("method.hint")}>
                      {t("method.label")}
                      <select
                        value={damageMethod}
                        onChange={(e) => setDamageMethod(e.target.value as DamageMethod)}
                        style={{ fontSize: "0.8rem" }}
                      >
                        {methodOptions.map((method) => (
                          <option key={methodKey(method)} value={methodKey(method)}>
                            {methodLabel(method, methodOptions, methodsCatalog, i18n)}
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
                  </div>
                )}
              </HazardCard>
            );
          })}
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
          <details
            open={realtimeOpen}
            onToggle={(e) => setRealtimeOpen(e.currentTarget.open)}
            style={stackedPanel(realtimeOpen)}
          >
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
            style={stackedPanel(legendOpen)}
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
                infraCounts={
                  floodKind ? (floodResult?.infrastructure_summary ?? null) : (result?.infrastructure_summary ?? null)
                }
                flood={
                  floodKind ? (
                    <FloodLegend
                      kind={floodKind}
                      status={isRunning ? "loading" : floodResult ? "ready" : "idle"}
                      show={floodLayers}
                      onShowChange={setFloodLayers}
                      returnPeriod={floodResult?.flood.return_period ?? returnPeriod}
                    />
                  ) : undefined
                }
                showAreas={showAreas}
                onShowAreasChange={setShowAreas}
                areasStatus={isRunning ? "loading" : (floodKind ? floodResult : result) ? "ready" : "idle"}
                areasKey={floodKind ? <FloodShareKey /> : undefined}
                areaLevel={areaLevel}
              />
            </div>
          </details>
        </div>
        {floodKind && floodResult && (
          <FloodSidebar
            title={floodTitle(floodResult, adminIndex, i18n)}
            result={floodResult}
            selectedMunicipality={floodMunicipality}
            sections={floodSections}
            sectionsError={floodSectionsError}
            selectedSectionCode={floodSectionCode}
            onSelectMunicipality={setFloodMunicipalityCode}
            onSelectSection={setFloodSectionCode}
            infrastructure={floodInfrastructure}
            focusedAssetId={focusedAsset?.asset.asset_id ?? null}
            onSelectAsset={focusAsset}
            provinceNames={provinceNames}
            onClose={clearFlood}
          />
        )}
        {hazard === "seismic" && result && (
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
// Everything in the left column (hazard cards, Real time, Legend) shares one
// fixed width, so no panel resizes with its content: switching hazard,
// language, or the legend's municipality/section title as the map zooms.
// Sized for the longest single-line rows ("Estaciones meteorológicas
// (AEMET)" and "Zonas afectadas (secciones censales)", each beside a
// toggle); anything longer wraps.
const LEFT_COLUMN_WIDTH = "19rem";
// Real time and Legend collapsed: just their title, both the same width.
const COLLAPSED_PANEL_WIDTH = "8rem";

// One of the bottom-left collapsible panels, at the column width when open
// and the (shared) collapsed width when not.
// The hazard's docs page (apps/docs, served under /docs), in the app's
// language: English pages sit at the root, Spanish ones under /docs/es/.
// A damage-method option's label: the translated "model (database)" name,
// plus the classification scheme when that model + database pair offers
// more than one. Unknown ids (a method added server-side before the
// frontend knows it) fall back to GET /methods' own English names.
function methodLabel(
  method: DamageMethodParams,
  options: DamageMethodParams[],
  catalog: MethodsCatalog | null,
  { t, has }: I18n
): string {
  const translated = (key: string, fallback: string) => (has(key) ? t(key as TranslationKey) : fallback);
  const apiName = (list: { id: string; name: string }[] | undefined, id: string) =>
    list?.find((item) => item.id === id)?.name ?? id;
  const pair = `${method.damage_model}:${method.vulnerability_db}`;
  let label = translated(
    `method.${pair}`,
    `${apiName(catalog?.damage_models, method.damage_model)} (${apiName(catalog?.vulnerability_databases, method.vulnerability_db)})`
  );
  const schemes = options.filter((o) => `${o.damage_model}:${o.vulnerability_db}` === pair);
  if (schemes.length > 1) {
    label += ` · ${translated(
      `method.classification.${method.classification}`,
      apiName(catalog?.classifications, method.classification)
    )}`;
  }
  return label;
}

// The hazard cards, top to bottom: twinQUAKE, twinFLOOD (river), twinCOAST.
type HazardCardId = "seismic" | FloodKind;
const HAZARD_CARDS: readonly HazardCardId[] = ["seismic", "flood", "coast"];
const CARD_NAMES: Record<HazardCardId, string> = { seismic: "QUAKE", flood: "FLOOD", coast: "COAST" };
const CARD_TITLES = {
  seismic: "card.quakeTitle",
  flood: "card.floodTitle",
  coast: "card.coastTitle",
} as const satisfies Record<HazardCardId, TranslationKey>;

function hazardDocsHref(card: HazardCardId, language: Language): string {
  const page = { seismic: "earthquake", flood: "flood", coast: "coast" }[card];
  return `/docs/${language === "es" ? "es/" : ""}hazards/${page}/`;
}

function stackedPanel(open: boolean): React.CSSProperties {
  return { ...stackedPanelBase, width: open ? LEFT_COLUMN_WIDTH : COLLAPSED_PANEL_WIDTH };
}

const stackedPanelBase: React.CSSProperties = {
  ...overlayPanel,
  position: "static",
  boxSizing: "border-box",
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

// "Flood T=100 · Comunitat Valenciana" or "Flood T=100 · 12 km circle".
function floodTitle(result: FloodResult, index: AdminArea[] | null, { t, fmtDecimal }: I18n): string {
  const { region, return_period } = result.flood;
  const area =
    region.type === "circle"
      ? t("flood.circleTitle", { radius: fmtDecimal(region.radius_km, 1) })
      : (index?.find((a) => a.level === region.level && a.code === region.code)?.name ?? region.code);
  return t(result.hazard === "coast" ? "coast.title" : "flood.title", { period: return_period, area });
}
