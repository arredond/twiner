import numpy as np
import pandas as pd
from exposure.census_sections import assign_sections, built_area_m2, load_population
from shapely.geometry import box

_HEADER = "Provincias;Municipios;Secciones;Sexo;Edad;Periodo;Total\n"


def _row(section: str, sex: str, age: str, year: str, total: str) -> str:
    return f"30 Murcia;30024 Lorca;{section} Lorca sección 01001;{sex};{age};{year};{total}\n"


def test_load_population_sums_dependent_age_groups_for_the_reference_year(tmp_path):
    rows = [
        _row("3002401001", "Total", "Todas las edades", "2025", "1.507"),
        _row("3002401001", "Total", "De 0 a 4 años", "2025", "21"),
        _row("3002401001", "Total", "De 10 a 14 años", "2025", "27"),
        _row("3002401001", "Total", "De 15 a 19 años", "2025", "35"),
        _row("3002401001", "Total", "De 65 a 69 años", "2025", "139"),
        _row("3002401001", "Total", "100 y más años", "2025", "1"),
        # Ignored: other year, per-sex rows, a section retired before 2025.
        _row("3002401001", "Total", "Todas las edades", "2024", "9.999"),
        _row("3002401001", "Hombres", "Todas las edades", "2025", "748"),
        _row("3002401099", "Total", "Todas las edades", "2025", ""),
        "30 Murcia;;;Total;Todas las edades;2025;98.613\n",
    ]
    path = tmp_path / "t.csv"
    path.write_text("﻿" + _HEADER + "".join(rows), encoding="utf-8")

    pop = load_population([path]).set_index("code")
    assert list(pop.index) == ["3002401001"]
    assert pop.loc["3002401001", "population"] == 1507
    assert pop.loc["3002401001", "pop_under_15"] == 48
    assert pop.loc["3002401001", "pop_65_plus"] == 140


def test_assign_sections_uses_containment_then_nearest():
    codes = np.array(["A", "B"], dtype=object)
    geoms = np.array([box(0, 0, 1, 1), box(1, 0, 2, 1)])
    result = assign_sections(
        np.array([0.5, 1.5, 2.2, -0.1]), np.array([0.5, 0.5, 0.5, 0.5]), codes, geoms
    )
    assert list(result) == ["A", "B", "B", "A"]


def test_built_area_prefers_cadastral_floor_area_else_footprint_times_floors():
    area = built_area_m2(
        pd.Series([228, None, 0, None]),
        pd.Series([2, 3, None, None]),
        pd.Series([100.0, 50.0, 80.0, 40.0]),
    )
    assert list(area) == [228.0, 150.0, 80.0, 40.0]
