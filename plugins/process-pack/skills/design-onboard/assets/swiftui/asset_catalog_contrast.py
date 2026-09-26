#!/usr/bin/env python3
"""
Contrast check over a SwiftUI asset catalog.

Reads every *.colorset/Contents.json under the catalog, and checks each pair
of named colors in each appearance ("any" and "dark"). A color with no dark
variant uses its "any" value in dark mode, as the system does.

Usage:
    python3 asset_catalog_contrast.py <Assets.xcassets> --pairs <pairs.json>

pairs.json: [{"fg": "TextPrimary", "bg": "Background", "min": 4.5}]
Names are colorset folder names without ".colorset".

Prints one line per pair per appearance and exits 1 if any pair fails.
Standard library only. Copied into a consuming repo by the design-onboard skill.
"""
import argparse
import json
import sys
from pathlib import Path


def _component(raw):
    """Xcode writes components as 0-1 floats ("0.200"), 0x hex bytes ("0x33"), or 0-255 integers ("51")."""
    text = str(raw).strip()
    if text.lower().startswith("0x"):
        return int(text, 16) / 255
    if "." in text:
        return float(text)
    return int(text) / 255


def _appearance(entry):
    for item in entry.get("appearances", []):
        if item.get("appearance") == "luminosity":
            return item.get("value")
    return "any"


def load_catalog(catalog):
    """Maps each color name to {"any": (r, g, b), "dark": (r, g, b)} on a 0-1 scale."""
    colors = {}
    for contents in Path(catalog).rglob("*.colorset/Contents.json"):
        name = contents.parent.name[: -len(".colorset")]
        variants = {}
        for entry in json.loads(contents.read_text()).get("colors", []):
            components = entry.get("color", {}).get("components")
            if not components:
                continue
            alpha = _component(components.get("alpha", "1"))
            if alpha < 1:
                raise ValueError(f"{name}: alpha {alpha} is not opaque; contrast would be a guess")
            appearance = _appearance(entry)
            if appearance in ("any", "dark"):
                variants[appearance] = tuple(_component(components[c]) for c in ("red", "green", "blue"))
        if "any" in variants:
            variants.setdefault("dark", variants["any"])
            colors[name] = variants
    return colors


def _linear(v):
    return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4


def _luminance(rgb):
    r, g, b = (_linear(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a, b):
    la, lb = _luminance(a), _luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def check(catalog, pairs):
    colors = load_catalog(catalog)
    results = []
    for appearance in ("any", "dark"):
        for pair in pairs:
            fg, bg, minimum = pair["fg"], pair["bg"], pair["min"]
            missing = [n for n in (fg, bg) if n not in colors]
            if missing:
                results.append({"appearance": appearance, "fg": fg, "bg": bg, "min": minimum, "ratio": None, "pass": False,
                                "line": f"{appearance} {fg} on {bg}: missing color {', '.join(missing)} FAIL"})
                continue
            ratio = contrast_ratio(colors[fg][appearance], colors[bg][appearance])
            ok = ratio >= minimum
            results.append({"appearance": appearance, "fg": fg, "bg": bg, "min": minimum, "ratio": ratio, "pass": ok,
                            "line": f"{appearance} {fg} on {bg}: {ratio:.2f}, needs {minimum} {'PASS' if ok else 'FAIL'}"})
    return results


def main(argv):
    parser = argparse.ArgumentParser(prog="asset_catalog_contrast.py")
    parser.add_argument("catalog")
    parser.add_argument("--pairs", required=True)
    args = parser.parse_args(argv)
    results = check(args.catalog, json.loads(Path(args.pairs).read_text()))
    for r in results:
        print(r["line"])
    return 0 if all(r["pass"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
