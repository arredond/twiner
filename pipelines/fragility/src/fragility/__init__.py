"""twiner fragility pipeline: Martins & Silva (2020) global fragility functions.

Source: https://github.com/lmartins88/global_fragility_vulnerability
(CC BY-SA 4.0 -- attribution required, see docs/merisur.md §4.5/§4.9 and
docs/milestone-1-plan.md §2 for why we use this instead of MERISUR's own,
Lorca-specific capacity curves).

Martins, L. & Silva, V. (2020), "Development of a Fragility and
Vulnerability Model for Global Seismic Risk Analyses", Bulletin of
Earthquake Engineering.

We vendor a curated subset (not the full ~561-file repository) covering the
GEM-taxonomy classes our exposure pipeline's taxonomy heuristic
(pipelines/exposure) can actually produce: reinforced-concrete dual-system
low-ductility (CR_LDUAL-DUL), generic unreinforced masonry load-bearing-wall
non-ductile (MUR_LWAL-DNO -- ADR-0032; earlier versions vendored
MR_LWAL-DUL, which is GEM's *reinforced* masonry), and unreinforced
rubble-stone masonry, non-ductile (MUR-STRUB_LWAL-DNO -- added per
docs/validation-lorca-2011.md §10.1/§10.4 for pre-1940 vernacular
construction), across the height classes (H1..H12 for concrete, H1..H5 for
the masonry classes -- see TAXONOMY_CLASSES).
"""

from .source import TAXONOMY_CLASSES, fetch_fragility_functions, write_fragility_parquet

__all__ = ["TAXONOMY_CLASSES", "fetch_fragility_functions", "write_fragility_parquet"]
