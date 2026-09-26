"""Schema tests for the design taste file (constants/schemas/design-taste.schema.json)."""
import copy
import json
from pathlib import Path

import jsonschema
import pytest
import yaml

CONSTANTS = Path(__file__).resolve().parent.parent
SCHEMA_PATH = CONSTANTS / "schemas" / "design-taste.schema.json"
EXAMPLE_PATH = CONSTANTS / "examples" / "design-taste.yaml"
REAL_PATH = Path("~/.config/process-pack/design-taste.yaml").expanduser()

DIMENSIONS = [
    "hierarchy",
    "identity",
    "containment and space",
    "typography",
    "color",
    "density and rhythm",
    "motion and state",
    "consistency",
]


def load_schema():
    return json.loads(SCHEMA_PATH.read_text())


def load_yaml(path):
    return yaml.safe_load(path.read_text())


def test_example_validates():
    jsonschema.validate(load_yaml(EXAMPLE_PATH), load_schema())


def test_rule_missing_escape_hatch_fails():
    doc = copy.deepcopy(load_yaml(EXAMPLE_PATH))
    del doc["looks_to_avoid"][0]["escape_hatch"]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(doc, load_schema())


def test_eight_dimensions():
    doc = load_yaml(EXAMPLE_PATH)
    assert doc["critique_method"]["dimensions"] == DIMENSIONS


@pytest.mark.skipif(not REAL_PATH.exists(), reason="no real design taste file on this machine")
def test_real_file_validates():
    jsonschema.validate(load_yaml(REAL_PATH), load_schema())
