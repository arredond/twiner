// English UI strings: the reference catalog every other language's file is
// type-checked against (see ../index.ts), so a key added here without a
// translation elsewhere is a compile error.
//
// Flat dotted keys with `{name}` placeholders, and `_one`/`_other` suffixes
// for plurals (picked with Intl.PluralRules from the `count` variable) --
// the same shape as i18next's JSON catalogs, so moving to a full library
// (or a translation tool) later is a copy, not a rewrite.
export const en = {
  "app.tagline": "Seismic scenarios — Spain",
  "app.newRun": "New run",
  "app.running": "Running scenario…",
  "app.faultsError": "Faults: {message}",

  "mode.label": "Scenario mode",
  "mode.automatic": "Automatic",
  "mode.manual": "Manual",
  "mode.hintAutomatic": "Click a fault (dashed purple line) to run its maximum-magnitude earthquake.",
  "mode.hintFaultsOff": "Turn faults on in the legend to pick one.",
  "mode.hintManual": "Click anywhere on the map to place an earthquake.",

  // MERISUR's own labels for its three tiers (docs/merisur.md §4.7), and
  // the probability half of each for scenario titles.
  "probability.label": "Probability level",
  "probability.high": "High probability",
  "probability.low": "Low probability / high impact",
  "probability.very_low": "Very low probability / very high impact",
  "probability.short.high": "High probability",
  "probability.short.low": "Low probability",
  "probability.short.very_low": "Very low probability",

  "scenario.titleFault": "{name} - Mmax. {mag} - {probability}",
  "scenario.titleManual": "Manual - Mag. {mag} - {probability}",
  "scenario.summary": "{evaluated} buildings evaluated, {damaged} damaged",
  "scenario.finiteRupture": "finite rupture plane",
  "scenario.cached": "cached",

  "settings.open": "Settings",
  "settings.language": "Language",
  "settings.theme": "Appearance",
  "settings.themeLight": "Light",
  "settings.themeDark": "Dark",
  "settings.themeAuto": "Auto",
  "settings.themeAutoHint": "Follows your system setting",
  "settings.zoomIndicator": "Zoom indicator",

  "common.loading": "Loading…",
  "common.loadingInline": "loading…",
  "common.notEvaluated": "not evaluated",

  // Damage states (docs/merisur.md §4.6), keyed by the API's own names.
  "damage.None": "None",
  "damage.Slight": "Slight",
  "damage.Moderate": "Moderate",
  "damage.Extensive": "Extensive",
  "damage.Complete": "Complete",

  "legend.title": "Legend",
  "legend.faults": "Faults",
  "legend.showFaults": "Show faults",
  "legend.activeFault": "Active fault (QAFI)",
  "legend.damage": "Damage",
  "legend.showDamage": "Show damage",
  "legend.notEvaluated": "Not evaluated",
  "legend.debris": "Debris (façade buffer)",
  "legend.intensity": "Intensity (EMS-98, est.)",
  "legend.showIntensity": "Show intensity bands",
  "legend.infrastructure": "Critical infrastructure",
  "legend.showAllInfrastructure": "Show all critical infrastructure",
  "legend.showCategory": "Show {category}",
  "legend.affectedInScenario": "Affected in this scenario",

  "infra.category.health": "Health",
  "infra.category.care": "Care homes",
  "infra.category.emergency": "Emergency services",
  "infra.category.education": "Education",
  "infra.category.power": "Power",
  "infra.category.bridge": "Bridges",
  "infra.category.dam": "Dams",

  "infra.subtype.hospital": "Hospital",
  "infra.subtype.health_centre": "Health centre",
  "infra.subtype.care_home": "Care home",
  "infra.subtype.police": "Police / security",
  "infra.subtype.fire_civil_protection": "Fire / civil protection",
  "infra.subtype.school": "School",
  "infra.subtype.university": "University",
  "infra.subtype.substation": "Electrical substation",
  "infra.subtype.thermal": "Thermal power plant",
  "infra.subtype.hydro": "Hydroelectric plant",
  "infra.subtype.nuclear": "Nuclear power plant",
  "infra.subtype.solar_pv": "Solar PV plant",
  "infra.subtype.combined_cycle": "Combined-cycle plant",
  "infra.subtype.wind": "Wind farm",
  "infra.subtype.solar_thermal": "Solar thermal plant",
  "infra.subtype.bridge": "Bridge",
  "infra.subtype.dam": "Dam",

  "infra.popup.type": "Type",
  "infra.popup.length": "Length",
  "infra.popup.voltage": "Voltage",
  "infra.popup.registry.health": "National hospital catalogue (CNH) id",
  "infra.popup.registry.education": "School registry (RCD/RUCT) id",
  "infra.popup.registry.dam": "Dam inventory (IPE) id",
  "infra.popup.catastroBuilding": "Catastro building",
  "infra.popup.estimatedIntensity": "Estimated intensity",
  "infra.popup.buildingDamage": "Building damage",
  "infra.popup.belowAffected": "Below VI (not affected)",
  "infra.popup.outsideEvaluated": "Outside the evaluated area",
  "infra.popup.source": "Source: IGN Base Topográfica Nacional",

  "manual.title": "Manual earthquake",
  "manual.latitude": "Latitude",
  "manual.longitude": "Longitude",
  "manual.magnitude": "Magnitude (Mw)",
  "manual.styleOfFaulting": "Style of faulting",
  "manual.strikeSlip": "Strike-slip (default)",
  "manual.normal": "Normal",
  "manual.reverse": "Reverse",
  "manual.advanced": "Advanced: fault geometry (strike/dip/depth)",
  "manual.advancedHint":
    "Computes a real finite rupture plane (length/width derived from magnitude) instead of treating the earthquake as a single point.",
  "manual.strike": "Strike (°, 0-360, direction the fault runs)",
  "manual.dip": "Dip (°, 0-90, tilt from horizontal)",
  "manual.ztor": "Depth to top of rupture (km)",
  "manual.run": "Run scenario",

  "sidebar.close": "Close scenario",
  "sidebar.allMunicipalities": "← All municipalities",
  "sidebar.noDamage": "No municipality has damaged buildings in this scenario.",
  "sidebar.summary_one":
    "{count} municipality affected · {affected} residents affected, {displaced} displaced · {cost} · {debris} t debris",
  "sidebar.summary_other":
    "{count} municipalities affected · {affected} residents affected, {displaced} displaced · {cost} · {debris} t debris",
  "sidebar.searchSections": "Search section code…",
  "sidebar.searchSectionsLabel": "Search census sections",
  "sidebar.searchMunicipalities": "Search municipality or INE code…",
  "sidebar.searchMunicipalitiesLabel": "Search municipalities",
  "sidebar.sectionsWithDamage": "Census sections with damage",
  "sidebar.countOf": "({shown} of {total})",
  "sidebar.section": "Section {label}",
  "sidebar.showMore": "Show {count} more",
  "sidebar.noMatches": "No matches for “{query}”.",
  "sidebar.disclaimer": "Rough estimates from placeholder parameters -- hover a figure for how it's computed.",
  "sidebar.infraTitle": "Critical infrastructure affected ({count})",
  "sidebar.infraNote":
    "Estimated intensity VI or more, or on a damaged building. Only facilities on a building have a damage estimate.",
  "sidebar.showOnMap": "Show on the map",
  "sidebar.intensityTitle": "Estimated intensity (EMS-98)",
  "sidebar.buildingDamage": "Building damage: {breakdown}",

  "impact.buildingsAffected": "Buildings affected",
  "impact.buildingsAffectedHint":
    "Buildings with any predicted damage (Slight or worse), out of every building in the area.",
  "impact.population": "Population",
  "impact.populationHint": "Residents, INE Censo Anual de Población, 1 Jan 2025.",
  "impact.populationAffected": "Population affected",
  "impact.populationAffectedHint":
    "Residents of damaged buildings: each census section's population, spread over its buildings by number of dwellings.",
  "impact.vulnerableAffected": "Vulnerable affected",
  "impact.vulnerableAffectedHint":
    "Affected residents under 15 or 65 and over, assuming each section's age mix applies to every building in it.",
  "impact.displaced": "Displaced",
  "impact.displacedHint": "Residents of buildings with Extensive or Complete damage (likely unusable).",
  "impact.cost": "Material cost",
  "impact.costHint":
    "Built floor area × €1,000/m² replacement cost × repair ratio (2/10/43/100% for Slight..Complete, HAZUS). Placeholder.",
  "impact.debris": "Debris",
  "impact.debrisHint":
    "Built floor area × 1.1 t/m² × share turned to rubble (2/10/38/100% for Slight..Complete, HAZUS). Placeholder.",
  "impact.trucks": "Truck rotations",
  "impact.trucksHint": "Debris ÷ 20 t per dump-truck trip.",
  "impact.shoring": "Puntales (shoring props)",
  "impact.shoringHint":
    "1 prop per m² over 5% (Moderate) / 20% (Extensive) of built floor area; Complete is demolished, not propped. Placeholder.",

  "popup.floors": "Floors",
  "popup.built": "Built",
  "popup.use": "Use",
  "popup.typology": "Construction typology",
  "popup.heightClass": "Height class",
  "popup.predictedDamage": "Predicted damage",
  "popup.likelyNone": "Likely None (not individually evaluated)",
  "popup.debrisRing": "Debris ring",
  "popup.sectionTitle": "{municipality} · section {label}",
};
