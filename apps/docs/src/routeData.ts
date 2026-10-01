import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { API_SIDEBAR_LABELS, API_TAG_LABELS_ES } from './apiSidebar.mjs';

type SidebarEntry = App.Locals['starlightRoute']['sidebar'][number];

// Display names inside the API group, per locale: the plugin's "Overview"
// pages and the API's tag groups (English names, see apiSidebar.mjs).
// src/middleware.ts translates the same words in the page bodies.
const API_ENTRY_LABELS: Record<string, Record<string, string>> = {
	es: { Overview: 'Resumen', ...API_TAG_LABELS_ES },
};

function relabel(entries: SidebarEntry[], labels: Record<string, string>): SidebarEntry[] {
	return entries.map((entry) => {
		const label = labels[entry.label] ?? entry.label;
		return entry.type === 'group'
			? { ...entry, label, entries: relabel(entry.entries, labels) }
			: { ...entry, label };
	});
}

// Keep only the current locale's copy of the generated API reference in the
// sidebar (see the starlightOpenAPI comment in astro.config.mjs), and
// translate its entries' display names.
export const onRequest = defineRouteMiddleware((context) => {
	const route = context.locals.starlightRoute;
	const locale = route.locale ?? 'root';
	const own = API_SIDEBAR_LABELS[locale as keyof typeof API_SIDEBAR_LABELS];
	const others = new Set(Object.values(API_SIDEBAR_LABELS).filter((label) => label !== own));
	const labels = API_ENTRY_LABELS[locale];
	route.sidebar = route.sidebar
		.filter((entry) => !(entry.type === 'group' && others.has(entry.label)))
		.map((entry) =>
			labels && entry.type === 'group' && entry.label === own
				? { ...entry, entries: relabel(entry.entries, labels) }
				: entry,
		);
});
