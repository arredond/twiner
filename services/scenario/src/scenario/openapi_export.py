"""Writes the API's OpenAPI document for the docs site (bin/export-openapi).

`render()` is shared with test_api_reference.py, which fails when the
committed apps/docs/openapi.json no longer matches it.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def render() -> str:
    from .local import app

    return json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    Path(sys.argv[1]).write_text(render(), encoding="utf-8")


if __name__ == "__main__":
    main()
