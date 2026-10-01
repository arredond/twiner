# ADR-0031: Public documentation site (Starlight, served under /docs)

Status: accepted

## Context

`docs/` is an engineering log: ADRs, investigations and validation notes,
written for whoever works on the code next. Now that the PoC works, the
project needs documentation for the people who *use* it, mostly the
scientific community (not necessarily experts in every field). They need:

- an introduction to TWIN-ER: hazards, outputs and architecture;
- one page per hazard explaining the science step by step, with equations
  and citations;
- the data sources;
- an API reference.

The site should be in Spanish and English like the app, be served at
`https://twiner.arredon.do/docs`, run locally next to the app, and be
linked from each hazard card.

## Decision

**Astro Starlight in `apps/docs/`**, a separate npm project next to
`apps/web/`.

- **Search.** It builds to static HTML with offline search (Pagefind), so
  no search service is needed.
- **Languages.** It has built-in i18n. English is the root locale
  (`/docs/...`) and Spanish lives under `/docs/es/...`. Pages share file
  paths across locales, so the language switcher maps page to page.
- **Equations** are `$...$`/`$$...$$` in Markdown. Astro 7's Markdown
  processor (Sätteri) parses them (`features.math`), and a small mdast
  plugin (`src/plugins/katex.mjs`) renders them to static KaTeX HTML at
  build time. remark/rehype plugins (`remark-math`/`rehype-katex`) don't
  plug into Sätteri.
- **API reference.** It is generated from the scenario API's FastAPI app
  by `bin/export-openapi` into `apps/docs/openapi.json`, and rendered by
  `starlight-openapi`, which also generates curl/fetch snippets:
  - Response shapes live in `services/scenario/src/scenario/api_models.py`.
    They are attached with `responses=` and `response_model=None`, so they
    document without validating or filtering. `handler.py` builds the same
    payloads as plain dicts, and filtering in only one adapter would let
    the two drift.
  - `test_api_reference.py` fails when `openapi.json` is stale.
    `test_local_api.py` validates real responses against the models.
  - The reference is descriptive, not a stable public contract: no auth,
    versioning or rate limits yet.
  - **Spanish** (added after the first version, which reused the English
    spec under `/docs/es/api/`). The plugin has no i18n, so:
    - `bin/export-openapi` also writes `openapi.es.json`, with every
      summary and description replaced from the catalog
      `apps/docs/src/i18n/openapi.es.json`, keyed by the English text. The
      test fails on a missing or unused translation, so a route change
      can't leave the Spanish reference behind.
    - Tag names stay English in the Spanish spec, because the plugin builds
      tag page URLs from them and the language picker needs matching URLs.
      Their display names (`apiSidebar.mjs`) are applied by the sidebar
      route middleware and by `src/middleware.ts`.
    - `src/middleware.ts` also translates the plugin's own hardcoded labels
      ("Request Body", "required", "Any of:"...) on `/docs/es/api/` pages,
      on the rendered HTML (exact text nodes, «anchor» labels and
      aria-label/title attributes only). It works in dev and in the static
      build alike.
    - Field titles that Pydantic and FastAPI generate from field names
      ("Scenario Id") are dropped from both specs. They only repeated the
      field name.

**Hosting: the same Cloudflare Pages project as the app.** `apps/web`'s
`npm run build` now also runs `build:docs`, which builds `apps/docs` and
copies its `dist/` into `apps/web/dist/docs/`. That means one deploy, one
domain, and no Pages settings change. Astro is configured with
`base: '/docs'`.

**Local development.** `bin/twiner start` adds a `docs` tmux window running
the Astro dev server (first free port from 4321). The app's Vite dev
server redirects `/docs/...` to it (`TWINER_DOCS_PORT`), so the same links
work locally as in production and the hazard cards' info icons work
unchanged. It redirects rather than proxies: Astro's dev pages load their
scripts from root paths (`/@vite/client`, `/@id/...`, `/node_modules/...`)
that collide with the app's own dev server, so behind a proxy the docs'
client-side controls (language picker, theme switch) broke. `npm run dev` inside `apps/docs` also
works on its own for writing.

**Hazard cards** get an info icon. It opens
`/docs/[es/]hazards/{earthquake,flood}/` in a new tab, in the app's
language.

**Relationship to `docs/` and `DATA-SOURCES.md`.** They stay the
engineering record. The site is the curated, public version. When a model,
parameter or dataset changes, update both: the site's pages say what is
true for users, and the ADRs say why.

## Alternatives considered

- **Docusaurus.** It is mature and React-based like the app, but heavier,
  and it needs Algolia or a community plugin for search. Its i18n and
  OpenAPI options are comparable.
- **A separate Pages project, plus a Worker route on `/docs/*`.** That would
  let the docs deploy independently, at the cost of a second project and
  routing. Not worth it yet.
- **A hand-written API reference.** It would drift. Generating it from the
  FastAPI app keeps it next to the code, and a test enforces it.

## Consequences

- A frontend deploy now builds the docs too, adding about 10 seconds.
  Changing only `apps/docs` still triggers a Pages build of the whole site.
- Changing a route, its metadata or `api_models.py` needs
  `bin/export-openapi`, which the test reminds you of. So does bumping
  `API_VERSION`, since it is the spec's version.
- Five content pages in two languages need keeping in sync by hand.
