"""CLI: python -m basemap <out_dir> [--build YYYYMMDD] [--bbox W,S,E,N] [--maxzoom N]
[--upload s3://bucket/tiles/basemap] [--profile NAME] [--force]"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .source import DEFAULT_BBOX, DEFAULT_MAXZOOM, build_basemap, upload


def parse_bbox(value: str) -> tuple[float, float, float, float]:
    parts = [float(p) for p in value.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("bbox must be W,S,E,N")
    west, south, east, north = parts
    if not (west < east and south < north):
        raise argparse.ArgumentTypeError("bbox must be W,S,E,N with W < E and S < N")
    return west, south, east, north


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m basemap", description=__doc__)
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--build", help="build date (YYYYMMDD); default: the latest")
    parser.add_argument("--bbox", type=parse_bbox, default=DEFAULT_BBOX, help="W,S,E,N")
    parser.add_argument("--maxzoom", type=int, default=DEFAULT_MAXZOOM)
    parser.add_argument(
        "--upload", metavar="S3_PREFIX", help="e.g. s3://<DataBucketName>/tiles/basemap"
    )
    parser.add_argument("--profile", help="AWS CLI profile for --upload")
    parser.add_argument("--force", action="store_true", help="re-extract and re-fetch assets")
    args = parser.parse_args()
    # Progress lines interleave with pmtiles' own stderr output.
    sys.stdout.reconfigure(line_buffering=True)  # pyrefly: ignore[missing-attribute]

    manifest = build_basemap(args.out_dir, args.build, args.bbox, args.maxzoom, args.force)
    print(f"{args.out_dir} holds {manifest.build} (tileset v{manifest.tileset_version})")
    if args.upload:
        upload(args.out_dir, args.upload, args.profile)
        print(f"uploaded to {args.upload}")


if __name__ == "__main__":
    main()
