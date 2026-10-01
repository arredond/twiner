# apps/docs

The public documentation site, served at <https://twiner.arredon.do/docs/>
([Astro Starlight](https://starlight.astro.build/)). See
[ADR-0031](../../docs/decisions/0031-documentation-site.md) for how it is
built, hosted and linked from the app.

```
src/content/docs/        English pages (root locale: /docs/...)
src/content/docs/es/     Spanish pages, same file paths (/docs/es/...)
src/components/          Astro components used by the pages
src/plugins/katex.mjs    Renders $...$ / $$...$$ to static KaTeX HTML
openapi.json             API reference source, generated: bin/export-openapi
```

## Develop

`bin/twiner start` runs this site alongside the app. Open
<http://localhost:5173/docs/>: the app's dev server redirects `/docs` to this
one (port 4321, or the next free one in a worktree).
To work on the docs alone:

```bash
npm install
npm run dev        # http://localhost:4321/docs/
npm run build      # static site in dist/
```

## Writing

- Every page exists in both languages, at the same path. When you change
  one, change the other.
- Equations: `$inline$` and `$$display$$` (KaTeX). In Spanish pages, write
  decimal commas as `{,}` (`5{,}08`) so KaTeX doesn't add a space after
  them.
- Links between pages are absolute and include the base: `/docs/...` or
  `/docs/es/...`.
- The API reference comes from the scenario API's FastAPI app. Change
  routes and `services/scenario/src/scenario/api_models.py`, then run
  `bin/export-openapi`. Don't edit `openapi.json` or `openapi.es.json` by
  hand. Spanish text for the API goes in `src/i18n/openapi.es.json` (keyed
  by the English text; the export fails, naming the string, when one is
  missing). Spanish names for the API's tags go in `src/apiSidebar.mjs`,
  and for the plugin's own labels in `src/middleware.ts`.
