"""The docs site's API reference (apps/docs/openapi.json, and its Spanish
twin openapi.es.json) is generated from local.py's FastAPI app. Fail when
either is stale or the Spanish catalog is out of sync with the API, so a
route change can't ship with an out-of-date reference."""

from __future__ import annotations

import json
from pathlib import Path

from scenario.openapi_export import render, schema, translatable_strings, translate

DOCS = Path(__file__).resolve().parents[3] / "apps" / "docs"
CATALOG = DOCS / "src" / "i18n" / "openapi.es.json"


def _catalog() -> dict[str, str]:
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def test_docs_openapi_json_is_up_to_date():
    assert (DOCS / "openapi.json").read_text(encoding="utf-8") == render(schema()), (
        "apps/docs/openapi.json is stale: run bin/export-openapi"
    )


def test_spanish_catalog_translates_exactly_the_api_text():
    strings = translatable_strings(schema())
    catalog = _catalog()
    missing = sorted(strings - catalog.keys())
    unused = sorted(catalog.keys() - strings)
    assert not missing, f"add Spanish for these to {CATALOG.name}: {missing}"
    assert not unused, f"remove these from {CATALOG.name}, the API no longer has them: {unused}"


def test_docs_spanish_openapi_json_is_up_to_date():
    expected = render(translate(schema(), _catalog()))
    assert (DOCS / "openapi.es.json").read_text(encoding="utf-8") == expected, (
        "apps/docs/openapi.es.json is stale: run bin/export-openapi"
    )
