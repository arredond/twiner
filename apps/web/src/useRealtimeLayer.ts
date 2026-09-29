import { useEffect, useState } from "react";
import type { LayerStatus } from "./components/DamageLegend";

// Polling for the real-time layers (ADR-0026, RealtimePanel.tsx).

export interface RealtimeLayerState<T> {
  data: T | null;
  status: LayerStatus;
  error: string | null;
}

// Fetches `load` while `enabled`, now and every `intervalMs` after (skipped
// while the tab is hidden). A failed refresh keeps the last good data and
// reports the error alongside it.
export function useRealtimeLayer<T>(
  enabled: boolean,
  load: () => Promise<T>,
  intervalMs: number
): RealtimeLayerState<T> {
  const [state, setState] = useState<RealtimeLayerState<T>>({
    data: null,
    status: "idle",
    error: null,
  });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const refresh = () => {
      setState((s) => ({ ...s, status: "loading" }));
      load()
        .then((data) => !cancelled && setState({ data, status: "ready", error: null }))
        .catch(
          (e) =>
            !cancelled &&
            setState((s) => ({
              ...s,
              status: s.data ? "ready" : "idle",
              error: e instanceof Error ? e.message : String(e),
            }))
        );
    };
    refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, load, intervalMs]);
  return state;
}
