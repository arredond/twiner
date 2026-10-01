// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { satteri } from '@astrojs/markdown-satteri';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';
import { katexPlugin } from './src/plugins/katex.mjs';

// Served from the same Cloudflare Pages project as the app (apps/web), under
// /docs: apps/web's build copies this site's dist/ into its own dist/docs/.
// Locally, the app's Vite dev server proxies /docs to this one (bin/twiner).
export default defineConfig({
	site: 'https://twiner.arredon.do',
	base: '/docs',
	trailingSlash: 'always',
	markdown: {
		// Astro 7's Markdown processor parses $...$ / $$...$$ itself; the
		// plugin only renders the parsed math nodes with KaTeX at build time.
		processor: satteri({ features: { math: true }, mdastPlugins: [katexPlugin] }),
	},
	integrations: [
		starlight({
			title: 'TWIN-ER',
			description: 'A multi-hazard risk simulator for Spain, built on open data.',
			favicon: '/favicon.svg',
			defaultLocale: 'root',
			locales: {
				root: { label: 'English', lang: 'en' },
				es: { label: 'Español', lang: 'es' },
			},
			customCss: ['katex/dist/katex.min.css', './src/styles/custom.css'],
			plugins: [
				// Generated from the scenario API's FastAPI app by
				// bin/export-openapi; a test fails when it goes stale.
				starlightOpenAPI([
					{
						base: 'api',
						schema: './openapi.json',
						sidebar: { label: 'API reference', collapsed: true },
					},
				]),
			],
			sidebar: [
				{ label: 'Introduction', translations: { es: 'Introducción' }, link: '/' },
				{
					label: 'Hazards',
					translations: { es: 'Riesgos' },
					items: [
						{ label: 'twinQUAKE', link: '/hazards/earthquake/' },
						{ label: 'twinFLOOD', link: '/hazards/flood/' },
					],
				},
				{
					label: 'Reference',
					translations: { es: 'Referencia' },
					items: [
						{ slug: 'impact-estimates' },
						{ slug: 'data-sources' },
					],
				},
				...openAPISidebarGroups,
			],
		}),
	],
});
