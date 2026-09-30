"""Static picker thumbnails for the built-in basemaps (ADR-0028).

Every thumbnail shows the same fixed view, the Iberian Peninsula with some
sea and France around it, so the picker doesn't change as the map moves.
Output goes to src/assets/basemap-thumbnails/<id>.png, SIZE px square (the
picker shows them at up to 4.5rem, so this is about 2x).

    # IGN/IDEE WMTS: stitched from each service's own tiles.
    uv run --with pillow --with requests python apps/web/scripts/basemap_thumbnails.py wmts

    # Protomaps (vector, no raster tiles to stitch): crop and resize a
    # screenshot of the app showing the same view.
    uv run --with pillow python apps/web/scripts/basemap_thumbnails.py \
        screenshot protomaps-white ~/Desktop/white.png

Keep WMTS below in sync with basemaps.ts' BUILTIN_BASEMAPS.
"""

from __future__ import annotations

import io
import math
import sys
from pathlib import Path
from urllib.parse import urlencode

OUT_DIR = Path(__file__).resolve().parents[1] / "src" / "assets" / "basemap-thumbnails"
SIZE = 160
# lon, lat of the centre, and the width of the view in degrees of longitude.
CENTER = (-3.6, 40.0)
SPAN_DEG = 18.0
# Tiles are fetched at this zoom (256px tiles) and downscaled to SIZE.
ZOOM = 5
# Beyond a service's coverage; matches rasterStyle's light background.
BACKGROUND = (232, 232, 232, 255)

# id -> (service, layer, style, format), as in basemaps.ts.
WMTS = {
    "pnoa-ma": (
        "https://www.ign.es/wmts/pnoa-ma",
        "OI.OrthoimageCoverage",
        "default",
        "image/jpeg",
    ),
    "ign-base": ("https://www.ign.es/wmts/ign-base", "IGNBaseTodo", "default", "image/jpeg"),
    "ign-lidar": (
        "https://wmts-mapa-lidar.idee.es/lidar",
        "EL.GridCoverageDSM",
        "default",
        "image/png",
    ),
    "land-cover": (
        "https://servicios.idee.es/wmts/ocupacion-suelo",
        "LC.LandCoverSurfaces",
        "LC.LandCoverSurfaces.Default",
        "image/png",
    ),
    "mdt": ("https://servicios.idee.es/wmts/mdt", "Relieve", "Default", "image/jpeg"),
}


def world_px(lon: float, lat: float, zoom: int) -> tuple[float, float]:
    n = 256 * 2**zoom
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def tile_url(service: str, layer: str, style: str, fmt: str, z: int, x: int, y: int) -> str:
    params = {
        "SERVICE": "WMTS",
        "REQUEST": "GetTile",
        "VERSION": "1.0.0",
        "LAYER": layer,
        "STYLE": style,
        "FORMAT": fmt,
        "TILEMATRIXSET": "GoogleMapsCompatible",
        "TILEMATRIX": z,
        "TILEROW": y,
        "TILECOL": x,
    }
    return f"{service}?{urlencode(params)}"


def render_wmts(basemap_id: str) -> None:
    import requests
    from PIL import Image

    service, layer, style, fmt = WMTS[basemap_id]
    cx, cy = world_px(*CENTER, ZOOM)
    half = SPAN_DEG / 360 * 256 * 2**ZOOM / 2
    left, top, right, bottom = cx - half, cy - half, cx + half, cy + half
    tx0, ty0 = int(left // 256), int(top // 256)
    tx1, ty1 = int(right // 256), int(bottom // 256)

    mosaic = Image.new("RGBA", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256), BACKGROUND)
    session = requests.Session()
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            resp = session.get(tile_url(service, layer, style, fmt, ZOOM, tx, ty), timeout=60)
            if resp.status_code != 200 or not resp.headers.get("Content-Type", "").startswith(
                "image/"
            ):
                continue  # outside the service's coverage
            tile = Image.open(io.BytesIO(resp.content)).convert("RGBA")
            mosaic.alpha_composite(tile, ((tx - tx0) * 256, (ty - ty0) * 256))

    box = tuple(
        round(v) for v in (left - tx0 * 256, top - ty0 * 256, right - tx0 * 256, bottom - ty0 * 256)
    )
    thumb = mosaic.crop(box).resize((SIZE, SIZE), Image.Resampling.LANCZOS).convert("RGB")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    thumb.save(OUT_DIR / f"{basemap_id}.png", optimize=True)
    print(f"wrote {OUT_DIR / f'{basemap_id}.png'}")


def crop_screenshot(basemap_id: str, source: Path) -> None:
    """The largest centred square of `source`, resized to SIZE."""
    from PIL import Image

    img = Image.open(source).convert("RGB")
    side = min(img.size)
    left, top = (img.width - side) // 2, (img.height - side) // 2
    thumb = img.crop((left, top, left + side, top + side)).resize(
        (SIZE, SIZE), Image.Resampling.LANCZOS
    )
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    thumb.save(OUT_DIR / f"{basemap_id}.png", optimize=True)
    print(f"wrote {OUT_DIR / f'{basemap_id}.png'}")


def main() -> None:
    args = sys.argv[1:]
    if args[:1] == ["wmts"]:
        for basemap_id in args[1:] or WMTS:
            render_wmts(basemap_id)
    elif args[:1] == ["screenshot"] and len(args) == 3:
        crop_screenshot(args[1], Path(args[2]).expanduser())
    else:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
