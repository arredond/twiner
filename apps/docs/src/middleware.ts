import { defineMiddleware } from 'astro:middleware';
import { API_TAG_LABELS_ES } from './apiSidebar.mjs';

// starlight-openapi hardcodes its own labels in English ("Request Body",
// "required", "Any of:"...). The Spanish API pages (/docs/es/api/, built
// from openapi.es.json) get them translated here, on the rendered HTML. That
// covers both the dev server and the static build, without patching the
// plugin. Only exact matches are replaced: a whole text node, a «heading»
// in Starlight's anchor labels, or an aria-label/title attribute. The API's
// summaries and descriptions are already Spanish in the spec; its tag names
// stay English there (they're URLs) and are translated here.
const LABELS: Record<string, string> = {
	'Overview': 'Resumen',
	'Operations': 'Operaciones',
	'Information': 'Información',
	'OpenAPI version:': 'Versión de OpenAPI:',
	'Request Body': 'Cuerpo de la petición',
	'Responses': 'Respuestas',
	'Parameters': 'Parámetros',
	'Path Parameters': 'Parámetros de ruta',
	'Query Parameters': 'Parámetros de consulta',
	'Header Parameters': 'Parámetros de cabecera',
	'Cookie Parameters': 'Parámetros de cookie',
	'Headers': 'Cabeceras',
	'required': 'obligatorio',
	'additional properties': 'propiedades adicionales',
	'key': 'clave',
	'Any of:': 'Cualquiera de:',
	'One of:': 'Uno de:',
	'Allowed value:': 'Valor permitido:',
	'Allowed values:': 'Valores permitidos:',
	'Media type': 'Tipo de contenido',
	'Example': 'Ejemplo',
	'Examples': 'Ejemplos',
	'generated': 'generado',
	'Deprecated': 'Obsoleto',
	'Select code sample': 'Elegir ejemplo de código',
	'Code sample:': 'Ejemplo de código:',
	'Select media type': 'Elegir tipo de contenido',
	'Select example': 'Elegir ejemplo',
	'Toggle operation URLs': 'Mostrar u ocultar las URL de la operación',
	'The list of MIME types the operation can consume': 'Tipos MIME que acepta la operación',
	'More information': 'Más información',
	// The API's tag names (Earthquake, Flood...), English in the spec.
	...API_TAG_LABELS_ES,
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternation = Object.keys(LABELS)
	.sort((a, b) => b.length - a.length)
	.map(escape)
	.join('|');
// >  Label  <    «Label»    aria-label="Label" / title="Label" / label="Label"
const PATTERN = new RegExp(
	`(>\\s*)(${alternation})(\\s*<)|(«)(${alternation})(»)|((?:aria-label|title|label)=")(${alternation})(")`,
	'g',
);
// Constraint tags ("default: 100") are a prefix inside a text node.
const DEFAULT_PREFIX = />(\s*)default: /g;
// The overview pages' <title> and og:title ("Overview | TWIN-ER").
const OVERVIEW_TITLE = /(<title>|content=")Overview\b/g;
// Starlight's anchor label for the request body heading includes its
// "required" badge: «Request Bodyrequired».
const REQUEST_BODY_ANCHOR = /«Request Body(required)?»/g;

export function translateApiLabels(html: string): string {
	return html
		.replace(PATTERN, (_match, ...groups: (string | undefined)[]) => {
			const [a1, l1, b1, a2, l2, b2, a3, l3, b3] = groups;
			if (l1) return `${a1}${LABELS[l1]}${b1}`;
			if (l2) return `${a2}${LABELS[l2]}${b2}`;
			return `${a3}${LABELS[l3!]}${b3}`;
		})
		.replace(DEFAULT_PREFIX, '>$1por defecto: ')
		.replace(OVERVIEW_TITLE, `$1${LABELS['Overview']}`)
		.replace(REQUEST_BODY_ANCHOR, (_match, required) =>
			`«${LABELS['Request Body']}${required ? ` (${LABELS.required})` : ''}»`,
		);
}

export const onRequest = defineMiddleware(async (context, next) => {
	const response = await next();
	const base = import.meta.env.BASE_URL.replace(/\/$/, '');
	const isSpanishApiPage = context.url.pathname.startsWith(`${base}/es/api/`);
	if (!isSpanishApiPage || !response.headers.get('content-type')?.includes('text/html')) {
		return response;
	}
	const html = translateApiLabels(await response.text());
	const headers = new Headers(response.headers);
	headers.delete('content-length');
	return new Response(html, { status: response.status, headers });
});
