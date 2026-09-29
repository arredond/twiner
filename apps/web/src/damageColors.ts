// Damage-state color scale, matching MERISUR's damage-state legend
// (docs/merisur.md §4.6): None / Slight / Moderate / Extensive / Complete.
// Sequential, colorblind-considerate scale from green (no damage) to dark
// red (complete) -- not the final design pass, just a legible placeholder.
export const DAMAGE_COLORS: Record<string, string> = {
  None: "#2f9e44",
  Slight: "#f9c74f",
  Moderate: "#f3722c",
  Extensive: "#e5383b",
  Complete: "#7f1d1d",
  Unknown: "#adb5bd",
};

export const DAMAGE_STATES = ["None", "Slight", "Moderate", "Extensive", "Complete"] as const;
export type DamageState = (typeof DAMAGE_STATES)[number];

// Map overlay colours that depend on the basemap (Positron in light mode,
// Dark Matter in dark): the damage and intensity scales read on either,
// these don't.
// - debris: a neutral tone independent of DAMAGE_COLORS on purpose --
//   debris is a separate concept from a building's own damage color
//   (matching MERISUR's own separate "Load debris on map" toggle,
//   docs/merisur.md §5), not a restatement of it.
// - fault: QAFI active faults, dashed on the map, solid and thicker when
//   selected.
// - focusOutline: the municipality drilled into from the sidebar.
export const MAP_PALETTE = {
  light: { debris: "#5c4433", fault: "#7209b7", focusOutline: "#1c1c1c" },
  dark: { debris: "#a47e5f", fault: "#c77dff", focusOutline: "#f1f1f1" },
} as const;

// Click-to-highlight, on every selectable map feature (buildings, debris
// rings, sections, infrastructure) and the sidebar card it came from.
export const SELECTED_COLOR = "#ff2d95";
