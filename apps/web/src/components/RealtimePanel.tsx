import { useMemo } from "react";
import {
  AEMET_METRICS,
  DGT_CATEGORIES,
  DGT_CATEGORY_KEYS,
  WARNING_LEVELS,
  WARNING_WINDOWS,
  aemetMetric,
  fmtTime,
  overlapsWindow,
  type AemetMetricKey,
  type AemetObservations,
  type AemetWarnings,
  type DgtCategory,
  type DgtIncidents,
  type WarningWindow,
} from "../realtime";
import type { MessageKey } from "../i18n";
import { useI18n } from "../settings";
import { LayerSection } from "./DamageLegend";
import { Segmented } from "./Segmented";
import { Switch } from "./Switch";
import type { RealtimeLayerState } from "../useRealtimeLayer";

// The "Real time" panel (ADR-0026): live layers from official open-data
// APIs, each with its own toggle. Sits above the Legend (App.tsx), in the
// same collapsible style.

export interface RealtimePanelProps {
  // DGT incidents: which categories are drawn ([] = layer off).
  dgt: RealtimeLayerState<DgtIncidents>;
  dgtCategories: DgtCategory[];
  onDgtCategoriesChange: (categories: DgtCategory[]) => void;
  // AEMET stations, coloured by one metric.
  aemet: RealtimeLayerState<AemetObservations>;
  showAemet: boolean;
  onShowAemetChange: (show: boolean) => void;
  aemetMetric: AemetMetricKey;
  onAemetMetricChange: (metric: AemetMetricKey) => void;
  // AEMET warnings, for one time window ([start, end) epoch ms as well, for
  // the counts).
  warnings: RealtimeLayerState<AemetWarnings>;
  showWarnings: boolean;
  onShowWarningsChange: (show: boolean) => void;
  warningWindow: WarningWindow;
  onWarningWindowChange: (window: WarningWindow) => void;
  warningWindowRange: [number, number];
}

const meta: React.CSSProperties = {
  fontSize: "0.72rem",
  color: "var(--text-subtle)",
};

export function RealtimePanel({
  dgt,
  dgtCategories,
  onDgtCategoriesChange,
  aemet,
  showAemet,
  onShowAemetChange,
  aemetMetric: metricKey,
  onAemetMetricChange,
  warnings,
  showWarnings,
  onShowWarningsChange,
  warningWindow,
  onWarningWindowChange,
  warningWindowRange,
}: RealtimePanelProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const metric = aemetMetric(metricKey);
  const showDgt = dgtCategories.length > 0;

  const dgtCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of dgt.data?.features ?? []) counts[f.properties.category] = (counts[f.properties.category] ?? 0) + 1;
    return counts;
  }, [dgt.data]);
  const stationsWithMetric = useMemo(
    () => (aemet.data?.features ?? []).filter((f) => typeof f.properties[metricKey] === "number").length,
    [aemet.data, metricKey]
  );

  // Warned zones per level in the chosen window (one zone counts once per
  // level, however many slices or parameters it has).
  const warningCounts = useMemo(() => {
    const zones: Record<string, Set<string>> = {};
    for (const f of warnings.data?.features ?? []) {
      if (!overlapsWindow(f.properties, warningWindowRange)) continue;
      (zones[f.properties.level] ??= new Set()).add(f.properties.zone ?? f.properties.id);
    }
    return Object.fromEntries(Object.entries(zones).map(([level, set]) => [level, set.size]));
  }, [warnings.data, warningWindowRange]);

  const toggleCategory = (key: DgtCategory, on: boolean) =>
    onDgtCategoriesChange(DGT_CATEGORY_KEYS.filter((k) => (k === key ? on : dgtCategories.includes(k))));

  // Legend ramp: the metric's stops placed along the bar by value.
  const [lo, hi] = [metric.stops[0][0], metric.stops[metric.stops.length - 1][0]];
  const gradient = metric.stops.map(([v, c]) => `${c} ${((v - lo) / (hi - lo)) * 100}%`).join(", ");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        minWidth: "13.5rem",
      }}
    >
      <LayerSection
        title={t("realtime.dgt.title")}
        status={dgt.status}
        toggle={
          <Switch
            label={t("realtime.dgt.show")}
            checked={showDgt}
            onChange={(on) => onDgtCategoriesChange(on ? DGT_CATEGORY_KEYS : [])}
          />
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
          {DGT_CATEGORIES.map((c) => (
            <div key={c.key} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span
                style={{
                  flex: "none",
                  width: "0.7rem",
                  height: "0.7rem",
                  borderRadius: "50%",
                  background: c.color,
                }}
              />
              <span style={{ flex: 1 }}>{t(`realtime.dgt.category.${c.key}`)}</span>
              {dgt.data && (
                <span
                  style={{
                    color: "var(--text-subtle)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {i18n.fmtInt(dgtCounts[c.key] ?? 0)}
                </span>
              )}
              <Switch
                label={t("legend.showCategory", {
                  category: t(`realtime.dgt.category.${c.key}`).toLocaleLowerCase(i18n.locale),
                })}
                checked={dgtCategories.includes(c.key)}
                onChange={(on) => toggleCategory(c.key, on)}
              />
            </div>
          ))}
          {showDgt && <LayerMeta state={dgt} time={fmtTime(i18n, dgt.data?.published ?? null)} />}
          {showDgt &&
            Object.entries(dgt.data?.sources ?? {})
              .filter(([, status]) => status !== "ok")
              .map(([key, status]) => (
                <span key={key} title={status} style={{ ...meta, color: "var(--danger)" }}>
                  {t("realtime.dgt.sourceDown", { source: t(`realtime.dgt.feed.${key}` as MessageKey) })}
                </span>
              ))}
        </div>
      </LayerSection>

      <LayerSection
        title={t("realtime.aemet.title")}
        status={aemet.status}
        toggle={<Switch label={t("realtime.aemet.show")} checked={showAemet} onChange={onShowAemetChange} />}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.3rem",
            opacity: showAemet ? 1 : 0.4,
          }}
        >
          <select
            aria-label={t("realtime.aemet.metricLabel")}
            value={metricKey}
            onChange={(e) => onAemetMetricChange(e.target.value as AemetMetricKey)}
            style={{ fontSize: "0.8rem" }}
          >
            {AEMET_METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {t(`realtime.aemet.metric.${m.key}`)} ({m.unit})
              </option>
            ))}
          </select>
          <div>
            <div
              style={{
                height: "0.6rem",
                borderRadius: 2,
                background: `linear-gradient(to right, ${gradient})`,
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.7rem",
              }}
            >
              <span>{i18n.fmtInt(lo)}</span>
              <span>
                {i18n.fmtInt(hi)} {metric.unit}
              </span>
            </div>
          </div>
          {showAemet && (
            <LayerMeta
              state={aemet}
              time={fmtTime(i18n, aemet.data?.observed ?? null)}
              count={aemet.data ? t("realtime.aemet.stations", { count: stationsWithMetric }) : null}
            />
          )}
        </div>
      </LayerSection>

      <LayerSection
        title={t("realtime.warnings.title")}
        status={warnings.status}
        toggle={<Switch label={t("realtime.warnings.show")} checked={showWarnings} onChange={onShowWarningsChange} />}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", opacity: showWarnings ? 1 : 0.4 }}>
          <Segmented
            label={t("realtime.warnings.windowLabel")}
            value={warningWindow}
            options={WARNING_WINDOWS.map((w) => ({ value: w, label: t(`realtime.warnings.window.${w}`) }))}
            onChange={onWarningWindowChange}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
            {WARNING_LEVELS.map((l) => (
              <div key={l.key} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span
                  style={{ flex: "none", width: "0.9rem", height: "0.9rem", borderRadius: 2, background: l.color }}
                />
                <span style={{ flex: 1 }}>{t(`realtime.warnings.level.${l.key}`)}</span>
                {warnings.data && (
                  <span
                    title={t("realtime.warnings.zonesHint")}
                    style={{ color: "var(--text-subtle)", fontVariantNumeric: "tabular-nums" }}
                  >
                    {i18n.fmtInt(warningCounts[l.key] ?? 0)}
                  </span>
                )}
              </div>
            ))}
          </div>
          {showWarnings && <LayerMeta state={warnings} time={fmtTime(i18n, warnings.data?.issued ?? null)} />}
        </div>
      </LayerSection>
    </div>
  );
}

// "Updated 17:23 · 822 stations", or the error that stopped the last load.
function LayerMeta({
  state,
  time,
  count,
}: {
  state: RealtimeLayerState<unknown>;
  time: string | null;
  count?: string | null;
}) {
  const { t } = useI18n();
  if (state.error)
    return (
      <span style={{ ...meta, color: "var(--danger)" }}>{t("realtime.unavailable", { message: state.error })}</span>
    );
  if (!time) return null;
  return <span style={meta}>{[t("realtime.updated", { time }), count].filter(Boolean).join(" · ")}</span>;
}
