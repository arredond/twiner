"""Writes the API's OpenAPI documents for the docs site (bin/export-openapi).

`openapi.json` is the English reference. `openapi.es.json` is the same
document with every summary and description replaced from a Spanish
catalog, apps/docs/src/i18n/openapi.es.json, keyed by the English text. Tag
names stay English: the docs build page URLs from them, which must match
across languages for the language picker. Their Spanish display names live
in apps/docs/src/apiSidebar.mjs. test_api_reference.py fails when either file is
stale, when the catalog lacks a translation, or when it has one for text
the API no longer contains.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path
from typing import Any

_TEXT_KEYS = ("summary", "description")


def schema() -> dict:
    from .local import app

    return _drop_field_titles(copy.deepcopy(app.openapi()))


def _drop_field_titles(node: Any) -> Any:
    """Remove the titles FastAPI and Pydantic generate rather than ones we
    wrote: each property's and parameter's (from the field name,
    "scenario_id" -> "Scenario Id") and each inline response's ("Response
    200 Scenario Infrastructure"). They repeated what the page already
    shows, and in English on the Spanish pages. Named schema titles stay."""
    if isinstance(node, dict):
        for prop in (node.get("properties") or {}).values():
            if isinstance(prop, dict):
                prop.pop("title", None)
        if "in" in node and isinstance(node.get("schema"), dict):
            node["schema"].pop("title", None)
        for media in (node.get("content") or {}).values():
            inline = media.get("schema") if isinstance(media, dict) else None
            if isinstance(inline, dict) and str(inline.get("title", "")).startswith("Response "):
                inline.pop("title")
        for value in node.values():
            _drop_field_titles(value)
    elif isinstance(node, list):
        for item in node:
            _drop_field_titles(item)
    return node


def _rewrite(node: Any, fn) -> None:
    """Apply `fn` to every summary and description under `node`, in place;
    `fn` returns the replacement."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key in _TEXT_KEYS and isinstance(value, str):
                node[key] = fn(value)
            else:
                _rewrite(value, fn)
    elif isinstance(node, list):
        for item in node:
            _rewrite(item, fn)


def translatable_strings(document: dict) -> set[str]:
    found: set[str] = set()

    def collect(text: str) -> str:
        found.add(text)
        return text

    _rewrite(copy.deepcopy(document), collect)
    return found


def translate(document: dict, catalog: dict[str, str]) -> dict:
    """A copy of `document` with every translatable string replaced from
    `catalog`. Raises KeyError listing every string the catalog lacks."""
    missing = sorted(translatable_strings(document) - catalog.keys())
    if missing:
        raise KeyError(f"no translation for {len(missing)} string(s): {missing}")
    translated = copy.deepcopy(document)
    _rewrite(translated, catalog.__getitem__)
    return translated


def render(document: dict) -> str:
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    if len(sys.argv) != 4:
        print(f"usage: {sys.argv[0]} <openapi.json> <openapi.es.json> <es catalog.json>")
        raise SystemExit(1)
    english, spanish, catalog_path = sys.argv[1:]
    document = schema()
    catalog = json.loads(Path(catalog_path).read_text(encoding="utf-8"))
    Path(english).write_text(render(document), encoding="utf-8")
    Path(spanish).write_text(render(translate(document, catalog)), encoding="utf-8")


if __name__ == "__main__":
    main()
