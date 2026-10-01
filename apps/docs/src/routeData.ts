import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { API_SIDEBAR_LABELS } from './apiSidebar.mjs';

// Keep only the current locale's copy of the generated API reference in the
// sidebar (see the starlightOpenAPI comment in astro.config.mjs).
export const onRequest = defineRouteMiddleware((context) => {
	const route = context.locals.starlightRoute;
	const own = API_SIDEBAR_LABELS[(route.locale ?? 'root') as keyof typeof API_SIDEBAR_LABELS];
	const others = new Set(Object.values(API_SIDEBAR_LABELS).filter((label) => label !== own));
	route.sidebar = route.sidebar.filter((entry) => !(entry.type === 'group' && others.has(entry.label)));
});
