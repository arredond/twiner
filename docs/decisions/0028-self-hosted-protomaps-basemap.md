# ADR-0028: Self-hosted Protomaps basemap

Status: accepted

## Context

The default light and dark basemaps were CARTO's Positron and Dark Matter
(ADR-0027). They were fetched from `basemaps.cartocdn.com`, along with
their glyphs, which the overlays' own labels also used (AEMET station
values). That made a third-party CDN a hard dependency of every page load,
with usage terms we don't control. Protomaps publishes a daily
OpenStreetMap planet build as a single PMTiles archive
(https://maps.protomaps.com/builds/), and we already serve PMTiles
straight from the data bucket.

## Decision

- **ETL**: `pipelines/basemap` (`python -m basemap <out_dir>`) takes the
  latest build listed in `build-metadata.protomaps.dev/builds.json` (or
  `--build YYYYMMDD`) and runs `pmtiles extract` over a bbox, z0-15.
  Only the bbox's tiles are fetched, by range request. It also copies the
  `fonts/` and `sprites/v4/` the Protomaps styles need from
  `protomaps/basemaps-assets`, pinned to the commit it read. It writes a
  `protomaps.json` manifest (build, bbox, maxzoom, assets commit), and a
  rerun with the same inputs skips the extract. `--upload
  s3://<DataBucketName>/tiles/basemap` syncs the directory to the bucket.
- **Served from S3, local dev included**: the frontend reads the basemap
  from the bucket (`staticData.ts` `basemapDataUrl`) even when the other
  PMTiles come from `apps/web/public/data`. With `VITE_S3_DATA_BUCKET`
  unset, it uses the deployed bucket. A 21GB local copy would buy nothing:
  the basemap doesn't vary with the local dataset, and a copy under
  `public/` would be copied into `dist/` by every local `npm run build`.
  The bucket's CORS rule allows `http://localhost:5173` to `:5192`
  (`FRONTEND_ORIGINS` in infra/stacks/twiner_stack.py), so worktree dev
  servers on the next free ports get the basemap too.
- **Coverage**: the bbox defaults to `-36.650391,18.271086,27.070313,50.233152`.
  That covers Spain and the Canary Islands, plus a good part of Europe and
  North Africa around them. The first extract, of the 20260929 build, is
  21.2GB (the planet is 138GB).
- **Viewport**: the map's `maxBounds` comes from the extract's own header
  bounds (DamageMap reads the header once through the pmtiles protocol).
  The user can't pan or zoom out past the area we have tiles for, and a
  rerun with a different `--bbox` needs no frontend change. The bounds
  apply to every basemap, including IGN's rasters, which only cover Spain
  anyway.
- **Styles**: `@protomaps/basemaps` builds the layers. The `white` flavour
  replaces Positron and `black` replaces Dark Matter (ids
  `protomaps-white`/`protomaps-black`). Stored settings pointing at the old
  Carto ids fall back to following the theme. Both flavours share one
  source id (`protomaps`), so switching between them is a layer diff and
  the tiles stay loaded.
- **Labels**: the style is built for the UI language (`layers(..., { lang })`,
  with a local-name fallback). A language switch is now a `setStyle` diff,
  like a basemap switch. This replaces `basemapLabels.ts`, which rewrote
  Carto's hardcoded `{name_en}` fields.
- **Glyphs**: every basemap style, raster ones included, uses our own
  `fonts/`, so switches still don't reload glyphs. The overlays' labels use
  `Noto Sans Medium`. It is a single font on purpose: static glyph files
  can't serve MapLibre's combined font-stack requests.
- **Thumbnails**: every picker thumbnail now shows the same fixed view,
  the Iberian Peninsula with some sea and France around it
  (`THUMBNAIL_VIEW`, 18° wide). Before, the thumbnails followed the map's
  view (ADR-0027), which looked odd as the map zoomed. The built-ins' are
  static 160px PNGs in `apps/web/src/assets/basemap-thumbnails/`, made by
  `apps/web/scripts/basemap_thumbnails.py`. That script stitches the IGN
  WMTS thumbnails from each service's own z5 tiles, and makes the Protomaps
  ones by cropping a screenshot of the app. Protomaps has no raster tiles,
  and rendering the style headlessly would need MapLibre Native, which has
  no prebuilt binary for the Node version used here. User-added sources
  (and a built-in whose image is missing) are rendered once at that same
  view by `components/basemapThumbnails.ts`, on one hidden 80px MapLibre
  map shared by every thumbnail.

## Alternatives considered

- **Copy the whole planet.** Rejected: 138GB to stream through a laptop
  and store, for a Spain-focused app. Limiting the viewport to the extract
  avoids blank areas instead.
- **World at low zoom plus the bbox at full detail** (two archives).
  Rejected for now as more style complexity than it's worth once the
  viewport is bounded.
- **Protomaps' hosted API or GitHub-hosted fonts.** Rejected: it swaps one
  third-party dependency for another, which is what this removes.
- **Live mini-maps per thumbnail.** Rejected: up to three extra WebGL
  contexts, each loading its own tiles.
- **Thumbnails that follow the map's view** (ADR-0027's approach, briefly
  kept for Protomaps via the offscreen renderer). Rejected: a thumbnail
  that changes as the map zooms is distracting, and the view is often too
  close in to tell basemaps apart.

## Consequences

- The basemap is as fresh as the last ETL run. Rerun it (with `--upload`)
  to pick up newer OSM data. The fixed key `tiles/basemap/protomaps.pmtiles`
  means no frontend deploy, and pmtiles clients notice the new ETag.
- build.protomaps.com is flaky under `pmtiles extract`'s ~130 large range
  requests. On 2026-09-30 four direct attempts in a row failed, with 500s,
  a 524 origin timeout and HTTP/2 stream resets, and the extract can't
  retry or resume. So the ETL runs it against a small local proxy
  (`pipelines/basemap/src/basemap/proxy.py`) that retries each range
  request and resumes a broken transfer from the last byte it received,
  checking the ETag so a resumed read can't mix two builds. Retrying the
  whole extract from scratch is kept only as a last resort. The proxy also
  drops and resumes a stream that delivers under 1MB in 30s. Upstream
  sometimes trickles at tens of kB/s without ever tripping a read timeout;
  one attempt sat at 98% with an hour still to go because of that. Even
  so, the day's newest build could be two orders of magnitude slower to
  read than the previous day's, presumably because it wasn't in the CDN
  cache yet. The first extract used 20260929 for that reason. Any later
  rerun without `--build` moves to the newest build.
- The ETL needs the `pmtiles` CLI (`brew install pmtiles`), plus the AWS
  CLI for `--upload`.
- ADR-0027's Carto references are superseded by this. Its picker, WMTS and
  custom-source design is unchanged.
