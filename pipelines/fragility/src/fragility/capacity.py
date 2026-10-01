"""Fetch Martins & Silva's capacity curves for the classes we vendor.

The same repository as the fragility functions (source.py) publishes, under
`capacity/`, the capacity curve each fragility function was derived from:
spectral displacement vs spectral acceleration of the equivalent
single-degree-of-freedom system, as a short multilinear curve (origin,
cracking, yield, ultimate). The scenario service's capacity-spectrum damage
model (ADR-0033) reads them from a small CSV bundled with the service, so
this writes straight there rather than into data/.

CLI: python -m fragility.capacity <output.csv>
"""

from __future__ import annotations

import io
import sys

import pandas as pd
import requests

from .source import _HEIGHT_CLASSES, TAXONOMY_CLASSES

CAPACITY_BASE = (
    "https://raw.githubusercontent.com/lmartins88/global_fragility_vulnerability/master/capacity"
)


def fetch_capacity_curves(timeout: int = 30) -> pd.DataFrame:
    """Long format: taxonomy, height_class, point (0 = origin), sd_m, sa_g.
    (class, height) combinations the repository doesn't publish are
    skipped, as in `fetch_fragility_functions`."""
    frames = []
    for cls in TAXONOMY_CLASSES:
        for h in _HEIGHT_CLASSES:
            resp = requests.get(f"{CAPACITY_BASE}/{cls}_H{h}.csv", timeout=timeout)
            if resp.status_code == 404:
                continue
            resp.raise_for_status()
            curve = pd.read_csv(io.StringIO(resp.text))
            curve.columns = ["sd_m", "sa_g"]
            curve.insert(0, "point", range(len(curve)))
            curve.insert(0, "height_class", h)
            curve.insert(0, "taxonomy", cls)
            frames.append(curve)
    if not frames:
        raise RuntimeError("No capacity curves were fetched -- check CAPACITY_BASE / class names")
    return pd.concat(frames, ignore_index=True)


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python -m fragility.capacity <output.csv>", file=sys.stderr)
        raise SystemExit(2)
    curves = fetch_capacity_curves()
    curves.to_csv(sys.argv[1], index=False)
    n = curves[["taxonomy", "height_class"]].drop_duplicates().shape[0]
    print(f"wrote {n} capacity curves to {sys.argv[1]}")


if __name__ == "__main__":
    main()
