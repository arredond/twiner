// Renders the math nodes Sätteri's parser emits (`math: true`) to static
// KaTeX HTML at build time, so pages ship no math JavaScript.
import katex from 'katex';

function render(node, ctx, displayMode) {
	const html = katex.renderToString(node.value, { displayMode, throwOnError: true, output: 'html' });
	ctx.replaceNode(node, { type: 'html', value: displayMode ? `<div class="math-display">${html}</div>` : html });
}

export const katexPlugin = {
	name: 'katex',
	math(node, ctx) {
		render(node, ctx, true);
	},
	inlineMath(node, ctx) {
		render(node, ctx, false);
	},
};
