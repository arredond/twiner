"""The docs site's API reference (apps/docs/openapi.json) is generated from
local.py's FastAPI app. Fail when it's stale, so a route change can't ship
with an out-of-date reference."""

from __future__ import annotations

from pathlib import Path

from scenario.openapi_export import render

OPENAPI_JSON = Path(__file__).resolve().parents[3] / "apps" / "docs" / "openapi.json"


def test_docs_openapi_json_is_up_to_date():
    assert OPENAPI_JSON.read_text(encoding="utf-8") == render(), (
        "apps/docs/openapi.json is stale: run bin/export-openapi"
    )
