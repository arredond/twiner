# ADR-0026: Real-time layers (DGT incidents, AEMET stations and warnings)

Status: accepted (local; the cloud stack needs a redeploy with the AEMET key
set, see "Deploying")

## Context

Emergency response needs to see what's happening now, next to what a scenario
predicts: which roads are cut, and what the weather is doing. We want a
second collapsible panel next to the Legend, "Real time", with toggleable
live layers. The first two are DGT traffic incidents and AEMET station
readings. The stations layer lets you pick the metric it shows (temperature
by default).

### Sources (investigated 2026-09-29)

**DGT: DATEX II v3.7 from the National Access Point.**
[`nap.dgt.es/datex2/v3/dgt/SituationPublication/datex2_v37.xml`](https://nap.dgt.es/datex2/v3/dgt/SituationPublication/datex2_v37.xml)
- No key. About 5.3 MB of XML. `Cache-Control: max-age=26`, so it's
  republished every minute or so.
- Checked on the day: 863 situations and 1,227 situation records. Roughly
  60% are roadworks. The rest are 300 stopped vehicles, 18 accidents, 37
  rockfalls/floods/fires, 28 slow-traffic records, and similar.
- The `v3.6` URL now 301s to v3.7. The old v1 feed
  (`infocar.dgt.es/datex2/dgt/SituationPublication/all/content.xml`)
  returns 404.
- **It sends no CORS headers**, so the browser can't call it directly.
- **Coverage gap:** it has no Basque Country records at all (Trafikoa
  manages traffic there) and only 22 of 2,022 location points in Catalonia
  (Servei Català de Trànsit manages most of it). Other regions are well
  covered. Closed by the next source.
- Each record has a location: a TPEG point, or a linear from/to pair.
  Either way it comes with coordinates plus DGT's Spanish extension (road
  kilometre point, municipality, province, autonomous community).

**SCT (Catalonia) and DT-GV (Basque Country): DATEX II v1 on the same NAP.**
[`/datex2/sct/SituationPublication/all/content.xml`](https://nap.dgt.es/datex2/sct/SituationPublication/all/content.xml)
and [`/datex2/dt-gv/SituationPublication/all/content.xml`](https://nap.dgt.es/datex2/dt-gv/SituationPublication/all/content.xml)
- No key, no CORS. About 1.1 MB and 0.8 MB.
- These are the older DATEX II v1 schema. The record's own type
  (`MaintenanceWorks`, `AbnormalTraffic`, ...) plays the role v3.7's
  `causeType` does. The km points are reference-point distances in metres.
- Checked on the day: 210 and 160 records. **88 of them (29 SCT, 59 DT-GV)
  have no coordinates**, only a road and km point.
- The DGT feed's few Catalonia records (12, all stopped vehicles) don't
  duplicate SCT's (works and congestion), so no deduplication is needed.

**No official source publishes stretch geometry.** All three feeds give a
stretch as road + start/end km + endpoint coordinates.
- 792 of ~1,200 DGT records were stretches: median 2 km, 185 over 5 km,
  30 over 20 km.
- The DGT's eTraffic map draws them as lines. It gets them from an internal
  endpoint (`/etrafficWEB/api/cache/getFilteredData`) whose responses are
  deliberately obfuscated (base64, XOR'd with a key in the bundle). That is
  not a public API, so we don't use it.
- IGN's road services were measured for fetching roads at request time
  instead:
  - IDEE OGC API `roadlink` is fast (0.4-1 s per rural box) but carries no
    road codes. A city box also returns ~52,000 links (16 MB per 10,000).
  - The INSPIRE transport WFS has road names, codes and kilometre posts,
    but spatial queries timed out at 60 s. Even without an area it took
    ~5 s for 2 roads, and names link to geometry only by reference.
  - Too slow and fragile for ~800 stretches, and a Lambda would need a
    persistent geometry cache on top.

**AEMET: OpenData conventional observations.**
[`opendata.aemet.es/opendata/api/observacion/convencional/todas`](https://opendata.aemet.es/opendata/api/observacion/convencional/todas)
- Returns every station's hourly readings for the last 24 h: 10,182 rows
  from ~857 stations when tested.
- It's a two-step API. The first response carries a short-lived `datos`
  URL, which holds the data.
- It sends `Access-Control-Allow-Origin: *`, but **every call needs an API
  key**. Keys are free and requested by email at
  [altaUsuario](https://opendata.aemet.es/centrodedescargas/altaUsuario).
  **They expire after ~3 months**: the current key expires on
  **2027-01-07**.
- Data files are ISO-8859-15, sometimes labelled otherwise.
- Not every station reports every metric. At the time of testing:
  temperature 847 stations, humidity 846, precipitation 833, wind 747,
  pressure only 295.

**AEMET: Meteoalerta warnings (CAP).**
[`opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/esp`](https://opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/esp)
- Same key and the same two-step API as the observations. The data is a
  tarball (~4 MB) with one CAP 1.2 XML file per alert.
- Each alert carries the level (`AEMET-Meteoalerta nivel`: verde,
  amarillo, naranja, rojo) and the phenomenon (rain, storms, wind, coastal,
  snow, heat, ...).
- It also carries each forecast zone's polygon ("lat,lon" pairs, sometimes
  two per zone), and Spanish and English text side by side.
- Checked on the day: 294 files from 14 emissions over the last day.
  - Most are green "no warning" files covering many zones.
  - 92 unexpired yellow/orange warnings.
  - 2 red ones that had expired that morning.
- **Overlaps are not duplicates.** Updates reference alerts outside the
  tarball, so supersession can't be resolved inside it. A zone's warning
  also comes split in two ways:
  - into consecutive time slices (yellow 11-14 h, orange 14-18 h,
    yellow 18-19 h);
  - by parameter (1 h and 12 h rainfall are separate warnings, often at
    different levels).
- Warnings run up to the end of the day after tomorrow.

## Decision

**Both sources go through the scenario API.**
- New routes: `GET /realtime/dgt-incidents` and
  `GET /realtime/aemet-observations`, in `local.py` and `handler.py`.
- Logic lives in `services/scenario` `realtime.py`. It's stdlib only
  (urllib, ElementTree), so the Lambda's cold path stays lean.
- DGT has to be proxied (no CORS). AEMET could be called from the browser,
  but only by shipping the key in the public bundle, where anyone could
  take it and exhaust its quota.
- Both return GeoJSON FeatureCollections and are cached in-process:
  - DGT for 60 s. A cold fetch plus parse takes ~0.2 s locally; a cache
    hit ~10 ms. Gzipped, the response is ~60 KB.
  - AEMET for 10 min, because it publishes hourly. A cold fetch takes
    ~1.3 s; the gzipped response is ~40 KB.
  - Concurrent requests on an expired entry wait on one upstream fetch.
- If the upstream source fails, or AEMET's key is unset or expired, the
  route returns 503 with the reason. The panel shows that reason under the
  layer; nothing else is affected.

**Traffic incidents: DGT, SCT and DT-GV as one layer**, one point per
situation record, at the record's start point.
- Each feed is fetched and cached separately, so one being down leaves the
  others on the map. The response's `sources` field says which loaded, and
  the panel names any that didn't. Each popup credits its own feed.
- SCT/DT-GV records without coordinates are skipped for now.
- Linear records have only their two end points. A straight line between
  them isn't the road, so we don't draw one (until the road network below).
- `causeType` maps to six colour categories: accident, obstruction,
  weather, congestion, roadworks, other. The exact cause and its detail are
  kept for the popup.
- Toggles work as for critical infrastructure. Each category switches on
  by itself, and the section's switch turns all of them on or off. None
  are on by default, and the feed is fetched while any category is on.
  Roadworks are most of the feed and mostly long-running, so switching on
  just the others is the quickest way to see what's happening now.

**AEMET: each station's latest hour.**
- A metric missing from that hour stays missing. We don't fall back to an
  older hour, so every value is from the time its popup shows.
- A station whose latest reading is more than 3 h older than the newest
  one overall is dropped (35 of 857 when tested).
- Stations that didn't report the chosen metric aren't drawn at all. A
  "no data" colour would read as a value.
- Selectable metrics: temperature, relative humidity, precipitation (last
  hour), wind speed, gust (last hour) and pressure. Wind is shown in km/h
  (AEMET reports m/s). From z7 the value is also drawn as a label.

**Frontend.**
- The panel is `RealtimePanel.tsx` and the map layers are
  `realtimeLayers.ts`.
- Real time sits in a bottom-left stack above the Legend. Both are
  collapsible and scroll on their own.
- A layer is fetched only while it's on. It's then refetched every 2 min
  (DGT) or 10 min (AEMET), except while the tab is hidden.
- The layers don't depend on any scenario: "New run" leaves them alone.

**Stretches as lines, along IGN's road network. Shelved (2026-09-29):**
built and tested, but off by default (`TWINER_TRAFFIC_LINES=1` enables it,
not set in the cloud stack) until the national file's missing provinces
are filled in. While off, incidents are points only, and SCT/DT-GV records
without coordinates are dropped.
- Source: IGR-RT "Redes de transporte", file *"España por modos. Red
  viaria"* (GeoPackage, 308.52 MB, July 2026 edition, CC BY 4.0), a manual
  download (CNIG blocks scripts, ADR-0025) into `data/roads/raw/`.
  - `rt_tramo_vial`: 1,018,567 road sections. The road code ("A-7",
    "N-634", "BV-4023") is in `nombre`.
  - `rt_ppkk_p`: 107,141 kilometre posts, with road and km.
- `pipelines/exposure` `roads_cli` compacts these in ~20 s into
  `data/roads/road_links.parquet` (847,296 coded sections on 15,904 roads,
  64 MB) and `road_km_posts.parquet` (2 MB). Both are sorted by road so the
  API reads only the roads it needs.
- At request time, `services/scenario` `roads.py`:
  - loads the roads that have incidents (~650);
  - snaps both ends of each stretch to every section of its road within
    60 m of the nearest (so both carriageways of a dual road are
    candidates);
  - bridges section ends under 25 m apart;
  - takes the shortest path, with junctions/roundabouts/service roads
    costing 3x.
- A path longer than 1.6x the stretch's own km range (+1.5 km) is
  rejected, and the stretch stays a point.
- Records with road + km but no coordinates are placed from the km posts.
  So are records whose feed repeats one point as both ends.
- Each drawn line is remembered by its location, so a refresh routes only
  new stretches. First call ~4.5 s locally, then ~0.3 s.
- The line is an extra LineString feature after the record's point, with
  the same properties. The map draws it under the markers, in the
  category colour, on a contrasting casing.
- **Coverage, 2026-09-29.** 582 of ~1,120 stretches drawn. Most failures
  are a data gap: **IGN's national roads file is missing about 20
  provinces almost entirely**. Checked against 25 municipalities per
  province, fewer than half had any road section within ~5 km:
  - Madrid; Albacete, Ciudad Real, Toledo;
  - Badajoz, Cáceres; Asturias, Lugo, Ourense;
  - León, Valladolid, Burgos; Alicante, Castellón; Cádiz, Jaén; Teruel;
  - the Balearic Islands and both Canary provinces.

  The raw GeoPackage itself has no sections there (its own spatial index
  confirms it), so it isn't our filtering. The per-province files should
  cover them, as they hold all roads plus urban streets and tracks.
- Basemap tiles were considered as a geometry source and rejected. In the
  browser they cover only what's on screen, simplified by zoom and cut at
  tile edges. Server-side, it would mean bulk-scraping a third-party tile
  service. Either way there are no km posts.

**AEMET warnings: one polygon feature per warned zone and slice.**
- Kept: yellow and up, not yet expired. Green and cancelled alerts are
  dropped.
- Each feature carries both languages' text, plus `onset_ms`/`expires_ms`
  for the map's filter.
- Cached 10 min like the observations. Gzipped, the response is ~13 KB.
- The panel shows warnings in force **now**, or at any time **today**,
  **tomorrow** or the **day after** (AEMET's own map horizons, in the
  viewer's local days).
- Higher levels draw on top. The level counts are warned zones, each
  counted once per level.
- A click lists every warning under the point, worst first, in the UI
  language.
- **Click behaviour.** Warning zones are large, so clicks only open their
  popup when nothing else was hit (building, asset, incident, station,
  choropleth). In Manual mode they never do: there a click places the
  earthquake, as before.

**Keys stay out of git.**
- Locally, `bin/twiner` reads `TWINER_AEMET_API_KEY` from the environment,
  or else from `~/.config/twiner/aemet_api_key`, which every worktree
  shares.
- In the cloud, the CDK stack copies `TWINER_AEMET_API_KEY` from the
  deploying shell into the scenario Lambda's environment.

## Alternatives considered

- **Calling AEMET from the browser.** Rejected because the key would be
  public (above).
- **The tiles Lambda instead of the scenario Lambda.** The tiles Lambda is
  lighter and has faster cold starts. But the scenario API is the one the
  frontend already calls for everything that isn't a tile, and it's kept
  warm by `/warmup`. Moving the routes over later only means changing
  `API_URL` in `realtime.ts`.
- **DGT's other outputs.** The eTraffic map's endpoints aren't documented
  or meant for reuse (CORS is locked to that site, and responses are
  obfuscated). DATEX II is the published, documented feed.
- **Road geometry at request time** from IGN's OGC API or WFS. Rejected on
  the measurements above.
- **Straight from→to lines.** Visibly wrong on the longer stretches.
- **OpenStreetMap roads.** Scriptable to download, but IGN's network is
  the official one and carries kilometre posts.

## Consequences

- **The AEMET key needs renewing every ~3 months** (next: 2027-01-07).
  When it expires, AEMET answers 401 and the layer shows "unavailable".
  Request a new key, replace `~/.config/twiner/aemet_api_key`, and
  redeploy with the new key in the environment.
- **Deploying.** The scenario Lambda needs a redeploy for the new routes.
  The deploying shell must have `TWINER_AEMET_API_KEY` set:
  `TWINER_AEMET_API_KEY=$(cat ~/.config/twiner/aemet_api_key) cdk deploy`.
  A deploy without it removes the key from the function.
- **Adding a layer.** A new real-time source means a fetch/parse function
  plus a route in `realtime.py`/`local.py`/`handler.py`, a section in
  `RealtimePanel.tsx`, and layers in `realtimeLayers.ts`.
- **IGN's national roads file has gaps** (found 2026-09-29, see
  "Stretches as lines" above): about 20 provinces have almost no sections.
  Stretches there stay points. The per-province files should cover them.
  Until then the whole feature is off (above).
