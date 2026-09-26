"""Tests for the SwiftUI guardrails: asset catalog contrast and the SwiftLint color-literal rule."""
import json
import re
import subprocess
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent
sys.path.insert(0, str(ASSETS))

from asset_catalog_contrast import check  # noqa: E402

CATALOG = HERE / "fixtures" / "Assets.xcassets"
PAIRS = json.loads((HERE / "fixtures" / "pairs.json").read_text())


def result(results, fg, appearance):
    return next(r for r in results if r["fg"] == fg and r["appearance"] == appearance)


def test_contrast_pass_and_fail():
    results = check(CATALOG, PAIRS)
    assert result(results, "TextPrimary", "any")["pass"] is True
    muted = result(results, "TextMuted", "any")
    assert muted["pass"] is False
    assert round(muted["ratio"], 2) == 2.85


def test_dark_appearance_checked():
    results = check(CATALOG, PAIRS)
    primary_dark = result(results, "TextPrimary", "dark")
    assert primary_dark["pass"] is True
    assert primary_dark["ratio"] > 15


def test_color_without_dark_uses_any():
    muted_dark = result(check(CATALOG, PAIRS), "TextMuted", "dark")
    assert muted_dark["pass"] is True


def test_cli_exits_1_on_failure():
    proc = subprocess.run(
        [sys.executable, str(ASSETS / "asset_catalog_contrast.py"), str(CATALOG), "--pairs", str(HERE / "fixtures" / "pairs.json")],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 1
    assert "any TextMuted on Background: 2.84, needs 4.5 FAIL" in proc.stdout


def swiftlint_regex():
    config = yaml.safe_load((ASSETS / "swiftlint.design.yml").read_text())
    return re.compile(config["custom_rules"]["no_color_literals"]["regex"])


LITERALS = [
    "let a = Color(red: 1, green: 0, blue: 0)",
    "let b = Color(.sRGB, red: 0.1, green: 0.2, blue: 0.3)",
    "let c = Color(hue: 0.5, saturation: 1, brightness: 1)",
    "let d = Color(white: 0.2)",
    "let e = UIColor(red: 1, green: 1, blue: 1, alpha: 1)",
    "let f = #colorLiteral(red: 1, green: 0, blue: 0, alpha: 1)",
    'let g = Color(hex: "#FF0000")',
]


def test_swiftlint_regex_matches():
    rx = swiftlint_regex()
    assert [line for line in LITERALS if not rx.search(line)] == []


def test_swiftlint_regex_ignores():
    rx = swiftlint_regex()
    assert not rx.search('Text("Hi").foregroundStyle(Color("brand"))')
    assert not rx.search("Button(\"Go\") {}.tint(Color.accentColor)")
