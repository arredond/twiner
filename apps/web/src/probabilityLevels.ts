import type { ProbabilityLevel } from "./scenarioApi";

// MERISUR's own labels for its three tiers (docs/merisur.md §4.7) -- kept
// verbatim rather than paraphrased, so this reads as "the same selector
// MERISUR has," not a twiner invention.
export const PROBABILITY_LEVEL_LABELS: Record<ProbabilityLevel, string> = {
  high: "High probability",
  low: "Low probability / high impact",
  very_low: "Very low probability / very high impact",
};

// Compact form for titles ("Alhama de Murcia (1/4) - Mmax. 6.7 - High
// probability"): the probability half of each MERISUR label.
export const PROBABILITY_LEVEL_SHORT_LABELS: Record<ProbabilityLevel, string> = {
  high: "High probability",
  low: "Low probability",
  very_low: "Very low probability",
};
