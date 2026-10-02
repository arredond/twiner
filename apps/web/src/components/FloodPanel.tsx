import { useEffect, useMemo, useState } from "react";
import {
  KIND_RETURN_PERIODS,
  loadAdminIndex,
  searchAdminAreas,
  type AdminArea,
  type AdminLevel,
  type FloodCoverage,
  type FloodKind,
  type ReturnPeriod,
} from "../floodApi";
import { useI18n } from "../settings";
import { Segmented } from "./Segmented";

// A flood mode's setup (river ADR-0029, coastal ADR-0037), in the top-left
// panel: the return period (like the seismic probability level) and how to
// pick the area -- draw a circle (default), or click a CCAA / province /
// municipality on the map. The search box finds an area at any level;
// picking one runs it. Coastal mode offers only T100/T500 and only the
// areas its maps reach (`coverage`).

export type RegionMode = "circle" | AdminLevel;

export function FloodPanel({
  kind,
  coverage,
  returnPeriod,
  onReturnPeriodChange,
  regionMode,
  onRegionModeChange,
  onPickArea,
  disabled,
}: {
  kind: FloodKind;
  // null: every area (river), or still loading (coast: then search waits).
  coverage: FloodCoverage | null;
  returnPeriod: ReturnPeriod;
  onReturnPeriodChange: (rp: ReturnPeriod) => void;
  regionMode: RegionMode;
  onRegionModeChange: (mode: RegionMode) => void;
  onPickArea: (area: AdminArea) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [index, setIndex] = useState<AdminArea[] | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadAdminIndex()
      .then((areas) => !cancelled && setIndex(areas))
      .catch((e) => !cancelled && setIndexError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const provinceNames = useMemo(
    () => new Map((index ?? []).filter((a) => a.level === "province").map((a) => [a.code, a.name])),
    [index]
  );
  const coverageReady = kind === "flood" || coverage !== null;
  const matches = useMemo(
    () => (index && coverageReady ? searchAdminAreas(index, query, 12, coverage) : []),
    [index, query, coverage, coverageReady]
  );

  const pick = (area: AdminArea) => {
    setQuery("");
    onPickArea(area);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
      <div style={{ fontSize: "0.8rem" }}>
        <div style={{ marginBottom: "0.2rem" }}>{t("flood.returnPeriod")}</div>
        <Segmented
          label={t("flood.returnPeriod")}
          value={String(returnPeriod)}
          options={KIND_RETURN_PERIODS[kind].map((rp) => ({
            value: String(rp),
            label: `T${rp}`,
            title: t(`flood.returnPeriodTitle.${rp}`),
          }))}
          onChange={(v) => onReturnPeriodChange(Number(v) as ReturnPeriod)}
        />
        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
          {t(`flood.returnPeriodTitle.${returnPeriod}`)}
        </div>
      </div>

      <div style={{ fontSize: "0.8rem" }}>
        <div style={{ marginBottom: "0.2rem" }}>{t("flood.areaPicker")}</div>
        <Segmented
          label={t("flood.areaPicker")}
          value={regionMode}
          options={[
            { value: "circle", label: t("flood.region.circle") },
            { value: "ccaa", label: t("flood.region.ccaa") },
            { value: "province", label: t("flood.region.province") },
            { value: "municipality", label: t("flood.region.municipality") },
          ]}
          onChange={onRegionModeChange}
        />
      </div>

      <div style={{ position: "relative" }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0] && !disabled) pick(matches[0]);
          }}
          disabled={disabled || !index || !coverageReady}
          placeholder={t("flood.searchPlaceholder")}
          aria-label={t("flood.searchLabel")}
          style={{ width: "100%", fontSize: "0.85rem", boxSizing: "border-box" }}
        />
        {matches.length > 0 && (
          <ul
            role="listbox"
            style={{
              position: "absolute",
              zIndex: 3,
              left: 0,
              right: 0,
              margin: "0.15rem 0 0",
              padding: 0,
              listStyle: "none",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              boxShadow: "0 2px 6px var(--shadow)",
              maxHeight: "16rem",
              overflowY: "auto",
            }}
          >
            {matches.map((area) => (
              <li key={`${area.level}:${area.code}`}>
                <button
                  type="button"
                  onClick={() => pick(area)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    background: "none",
                    color: "var(--text)",
                    padding: "0.3rem 0.5rem",
                    fontSize: "0.8rem",
                    cursor: "pointer",
                  }}
                >
                  <span>{area.name}</span>
                  <span style={{ color: "var(--text-subtle)", fontSize: "0.72rem", whiteSpace: "nowrap" }}>
                    {area.level === "municipality"
                      ? provinceNames.get(area.parent ?? "") ?? t("flood.region.municipality")
                      : t(`flood.region.${area.level}`)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {indexError && <p style={{ fontSize: "0.75rem", color: "var(--danger)", margin: 0 }}>{indexError}</p>}

      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
        {regionMode === "circle" ? t("flood.hintCircle") : t(`flood.hintAdmin.${regionMode}`)}
        {kind === "coast" && regionMode !== "circle" && ` ${t("coast.hintCoverage")}`}
      </p>
    </div>
  );
}
