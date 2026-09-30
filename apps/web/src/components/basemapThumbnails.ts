import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import { THUMBNAIL_VIEW } from "../basemaps";

// Picker thumbnails for basemaps without a static image: user-added sources
// (the built-ins' are in assets/basemap-thumbnails). Drawn at the fixed
// THUMBNAIL_VIEW by one hidden MapLibre map, reused for every thumbnail
// (one WebGL context, not one per miniature), and read back as an image.
// Uses the "pmtiles" protocol DamageMap registers.

// CSS px, a bit over the picker's largest miniature (4.5rem).
const SIZE = 80;
// The zoom at which SIZE px span THUMBNAIL_VIEW.spanDeg (512px tiles).
const ZOOM = Math.log2((SIZE * 360) / (THUMBNAIL_VIEW.spanDeg * 512));
// Give up waiting for every tile and take what has drawn.
const TIMEOUT_MS = 8000;

let renderer: maplibregl.Map | null = null;
// Renders run one at a time on the shared map.
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, Promise<string>>();

function getRenderer(style: StyleSpecification): maplibregl.Map {
  if (renderer) return renderer;
  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${SIZE}px`,
    height: `${SIZE}px`,
    pointerEvents: "none",
  });
  container.setAttribute("aria-hidden", "true");
  document.body.appendChild(container);
  renderer = new maplibregl.Map({
    container,
    style,
    center: [THUMBNAIL_VIEW.lng, THUMBNAIL_VIEW.lat],
    zoom: ZOOM,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    // toDataURL reads the canvas after the frame is presented.
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  return renderer;
}

function render(style: StyleSpecification): Promise<string> {
  const map = getRenderer(style);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      map.off("idle", finish);
      resolve(map.getCanvas().toDataURL("image/png"));
    };
    const timer = setTimeout(finish, TIMEOUT_MS);
    // A diff needs the current style fully loaded, else it throws: not so
    // right after the map is created, nor after a render that timed out.
    map.setStyle(style, { diff: map.isStyleLoaded() === true });
    map.on("idle", finish);
    // Nothing may have changed since the last render, in which case no
    // frame (and so no "idle") would follow on its own.
    map.triggerRepaint();
  });
}

// A data: URL of `style` at THUMBNAIL_VIEW. `key` names the style, since
// equal styles are built afresh by every caller.
export function renderThumbnail(key: string, style: StyleSpecification): Promise<string> {
  const cached = cache.get(key);
  if (cached) return cached;
  const job = queue.then(() => render(style));
  queue = job.catch(() => undefined);
  cache.set(key, job);
  return job;
}
