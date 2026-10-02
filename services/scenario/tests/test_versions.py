"""API_VERSION and DATA_VERSION are CalVer and logged in their changelogs."""

from __future__ import annotations

import re
from pathlib import Path

from scenario.scenario_id import API_VERSION

ROOT = Path(__file__).resolve().parents[3]
CALVER = re.compile(r"^\d{4}\.(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|3[01])\.[1-9]\d*$")


def _newest_entry(changelog: str) -> str:
    text = (ROOT / changelog).read_text(encoding="utf-8")
    return re.search(r"^## (\S+)$", text, re.MULTILINE).group(1)  # type: ignore[union-attr]


def _data_version() -> str:
    text = (ROOT / "infra/stacks/twiner_stack.py").read_text(encoding="utf-8")
    return re.search(r'^DATA_VERSION = "([^"]+)"', text, re.MULTILINE).group(1)  # type: ignore[union-attr]


def test_api_version_is_calver_and_logged():
    assert CALVER.match(API_VERSION)
    assert _newest_entry("CHANGELOG-API.md") == API_VERSION


def test_data_version_is_calver_and_logged():
    assert CALVER.match(_data_version())
    assert _newest_entry("CHANGELOG-DATA.md") == _data_version()
