# ADR-0027: Basemap picker (Carto, IGN/IDEE WMTS, user-added sources)

Status: accepted

## Context

The basemap used to be tied to the UI theme: Carto Positron in light mode,
Dark Matter in dark mode. For seismic work, context such as orthophotos,
terrain, LiDAR surface models and land cover matters, and Spain's IGN/IDEE
publish all of these as free WMTS services. Users also want to bring
their own tile sources.

## Decision

- A Google Maps-style miniature sits in the bottom-right corner
  (`components/BasemapPicker.tsx`). It shows a tile of the current basemap
  around the map centre. Clicking it opens a row of options, and a "+"
  tile opens a modal for a custom source.
- Built-in basemaps (`basemaps.ts`) are Carto Positron and Dark Matter
  (vector styles), plus PNOA MA (`OI.OrthoimageCoverage`), IGN Base
  (`IGNBaseTodo`), IGN LiDAR (`EL.GridCoverageDSM`), Ocupación del suelo
  (`LC.LandCoverSurfaces`) and MDT (`Relieve`). MDT uses the hillshade
  layer because the service's `EL.ElevationGridCoverage` is raw elevation
  in flat greys, which reads poorly as a basemap.
- WMTS is drawn as a plain MapLibre raster source using KVP GetTile on the
  `GoogleMapsCompatible` tile matrix set. MapLibre only renders Web
  Mercator. In that set the TileMatrix ids are the zoom levels, so
  `TILEMATRIX={z}&TILEROW={y}&TILECOL={x}` works as an XYZ template. Every
  IGN/IDEE endpoint sends `Access-Control-Allow-Origin: *` (checked
  2026-09-30).
- Custom sources accept four inputs:
  - an XYZ template (`{z}/{x}/{y}`, or `{-y}` for TMS);
  - a WMTS REST template;
  - a single GetTile URL, whose tile coordinates are replaced with
    placeholders;
  - a WMTS service or capabilities URL. The browser fetches the
    capabilities, keeps the layers that have a Web Mercator tile matrix
    set (checked by CRS, scale denominators and ids ending in the zoom
    level), and lets the user pick one.

  Custom sources are saved in the localStorage settings.
- `Settings.basemap` set to `null` means "follow the theme", which is the
  old behaviour and the default. Picking the theme's own Carto style
  resets the setting to `null`. Any other pick stays in place across theme
  switches. The overlay palette (`MAP_PALETTE`) still follows the theme
  only.
- Switching basemap works like the old theme switch: `map.setStyle` with
  `keepOverlays`. Because Carto and raster styles have different source
  ids, overlays are now told apart using the source ids of the *previous*
  basemap (tracked in a ref), not the next style's. Raster styles share
  Carto's glyphs, so the AEMET labels don't reload. The diff keeps overlay
  sources, feature-state and `addImage` icons.

## Alternatives considered

- **Parse WMTS capabilities for the built-ins at runtime.** Rejected: it
  adds a request and a failure mode for URLs that don't change. The
  layer, style and format values were read from each service's
  GetCapabilities once and hardcoded.
- **Reproject non-Mercator WMTS sets (e.g. EPSG:25830).** Out of scope.
  MapLibre can't do it, and every service here has a GoogleMapsCompatible
  set.

## Consequences

- A custom WMTS service that doesn't send CORS headers on GetCapabilities
  can't be read. The modal says so and suggests pasting a tile template
  instead (tiles need CORS as well, because MapLibre loads them as WebGL
  textures).
- No labels are drawn over raster basemaps. A "hybrid" option (PNOA +
  IGN Base's `IGNBaseOrto` label layer) would be an easy follow-up.
