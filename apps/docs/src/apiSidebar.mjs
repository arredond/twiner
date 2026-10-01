// Sidebar labels of the two generated API reference copies, by Starlight
// locale. Shared by astro.config.mjs and src/routeData.ts.
export const API_SIDEBAR_LABELS = {
	root: 'API reference',
	es: 'Referencia de la API',
};

// Spanish display names for the API's tags (Earthquake, Flood...). The tag
// names themselves stay English in openapi.es.json, because the plugin
// builds tag page URLs from them and those must match across languages.
// Used by src/routeData.ts (sidebar) and src/middleware.ts (page text).
export const API_TAG_LABELS_ES = {
	Earthquake: 'Terremotos',
	Flood: 'Inundaciones',
	Results: 'Resultados',
	Tiles: 'Teselas',
	Exposure: 'Exposición',
	'Real time': 'Tiempo real',
	Operations: 'Operaciones',
};
