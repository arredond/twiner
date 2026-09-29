import { DAMAGE_COLORS, DAMAGE_STATES } from "./damageColors";

// HTML helpers shared by the map's popups (buildings, debris, areas,
// critical infrastructure), which MapLibre takes as HTML strings.

// null/undefined render as an em dash, the popups' "no value".
export function escapeHtml(value: unknown): string {
  return String(value ?? "—").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

// One bar split by the probability of each damage state (`probs` in
// DAMAGE_STATES order), hover for the percentage -- the whole distribution,
// not just the state a building (or the facility on it) is labelled with.
export function renderProbabilityBarHtml(probs: readonly number[]): string {
  const segments = DAMAGE_STATES.map((state, i) => [state, probs[i] ?? 0] as const)
    .filter(([, p]) => p > 0)
    .map(([state, p]) => {
      const pct = Math.round(p * 100);
      return (
        `<div title="${escapeHtml(state)}: ${pct}%" ` +
        `style="flex:${p}; background:${DAMAGE_COLORS[state]}; height:100%"></div>`
      );
    })
    .join("");
  return (
    `<div style="display:flex; width:100%; height:0.9rem; border-radius:2px; ` +
    `overflow:hidden; margin:3px 0">${segments}</div>`
  );
}
