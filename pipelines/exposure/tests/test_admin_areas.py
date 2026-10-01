import geopandas as gpd
import shapely
from exposure.admin_areas import PROVINCE_TO_CCAA, PROVINCES, assign_provinces


def test_every_province_has_a_ccaa():
    assert set(PROVINCE_TO_CCAA) == set(PROVINCES)
    assert len(PROVINCES) == 52


def test_shared_territory_goes_to_the_province_it_borders_most():
    munis = gpd.GeoDataFrame(
        {
            "ine_code": ["31001", "26001", "53001"],
            "name": ["Navarra muni", "La Rioja muni", "Condominio"],
        },
        # The shared unit (53001) touches 31001 along 2 units of border and
        # 26001 along 1.
        geometry=[shapely.box(0, 0, 2, 2), shapely.box(2, 2, 3, 3), shapely.box(2, 0, 3, 2)],
        crs="EPSG:4326",
    )
    assert assign_provinces(munis).tolist() == ["31", "26", "31"]
