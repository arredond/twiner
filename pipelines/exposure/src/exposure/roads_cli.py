"""CLI: the road network for real-time traffic stretches (roads.py, ADR-0026).

    uv run python -m exposure.roads_cli data/roads/raw data/roads

`raw_dir` must already hold IGN's `rt_viaria.gpkg` (manual download, see
roads.py). Writes `road_links.parquet` and `road_km_posts.parquet` into
`out_dir`.
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

from .roads import build_km_posts, build_road_links, write_outputs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("raw_dir")
    parser.add_argument("out_dir")
    args = parser.parse_args()

    t0 = time.monotonic()
    links = build_road_links(args.raw_dir)
    posts = build_km_posts(args.raw_dir)
    write_outputs(links, posts, args.out_dir)
    out = Path(args.out_dir)
    print(
        f"{len(links):,} road sections on {links['road'].nunique():,} roads "
        f"({links['main'].mean():.0%} main line), {len(posts):,} km posts on "
        f"{posts['road'].nunique():,} roads, in {time.monotonic() - t0:.0f}s"
    )
    for name in ("road_links.parquet", "road_km_posts.parquet"):
        print(f"  {name}: {(out / name).stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
