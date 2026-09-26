"""Schema tests for the design block in .process/repo.yaml (constants/schemas/repo.schema.json)."""
import copy
import json
from pathlib import Path

import jsonschema
import pytest
import yaml

CONSTANTS = Path(__file__).resolve().parent.parent
SCHEMA = json.loads((CONSTANTS / "schemas" / "repo.schema.json").read_text())
EXAMPLE = yaml.safe_load((CONSTANTS / "examples" / "repo.example.yaml").read_text())


def test_example_with_design_validates():
    assert "design" in EXAMPLE
    jsonschema.validate(EXAMPLE, SCHEMA)


def test_design_bad_path_enum_fails():
    doc = copy.deepcopy(EXAMPLE)
    doc["design"]["path"] = "rebrand"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(doc, SCHEMA)


def test_ui_skill_needs_reason():
    doc = copy.deepcopy(EXAMPLE)
    del doc["design"]["ui_skills"][0]["reason"]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(doc, SCHEMA)
