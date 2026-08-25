#!/usr/bin/env python3
"""Dependency-free architecture contract checks for the documentation repository."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS_PATH = ROOT / "contracts" / "architecture-contracts.v1.json"
PLUGIN_SCHEMA_PATH = ROOT / "schemas" / "plugin-manifest.v1.schema.json"
APP_SCHEMA_PATH = ROOT / "schemas" / "application-manifest.v1.schema.json"
EVIDENCE_PATH = ROOT / "docs" / "adr" / "evidence-registry.json"
SCAN_EXTENSIONS = {".md", ".json", ".yaml", ".yml", ".ts", ".tsx"}

# Historical ADRs and the review disposition may quote superseded symbols.
LEGACY_SCAN_EXCLUSIONS = {
    Path("contracts/architecture-contracts.v1.json"),
    Path("scripts/validate_repository_contracts.py"),
    Path("docs/27-architecture-review-remediation.md"),
    Path("docs/28-contract-governance-and-determinism.md"),
}


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def load_json(path: Path, errors: list[str]) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # diagnostics tool must report all failures
        fail(errors, f"{path.relative_to(ROOT)}: invalid JSON: {exc}")
        return None


def check_identifier(value: str, pattern: str, label: str, errors: list[str]) -> None:
    if re.fullmatch(pattern, value) is None:
        fail(errors, f"{label}: {value!r} does not match {pattern!r}")


def validate_driver_fixture(contracts: dict[str, Any], errors: list[str]) -> None:
    path = ROOT / "fixtures" / "plugin-manifests" / "module.logistics.driver.json"
    data = load_json(path, errors)
    if not isinstance(data, dict):
        return
    required = {"apiVersion", "id", "kind", "displayName", "version", "package", "compatibility", "lifecycle"}
    missing = required - data.keys()
    if missing:
        fail(errors, f"{path.relative_to(ROOT)}: missing keys {sorted(missing)}")
    check_identifier(str(data.get("id", "")), contracts["identity"]["pluginIdPattern"], f"{path.relative_to(ROOT)} plugin ID", errors)
    compatibility = data.get("compatibility", {})
    if "databases" in compatibility:
        fail(errors, f"{path.relative_to(ROOT)}: legacy compatibility.databases is forbidden")
    if compatibility.get("payloadDatabaseAdapters") != ["postgres"]:
        fail(errors, f"{path.relative_to(ROOT)}: V1 fixture must declare postgres Payload adapter")
    lifecycle = data.get("lifecycle", {})
    if lifecycle.get("ownsPayloadSchema") is True and lifecycle.get("uninstall") != "unsupported":
        fail(errors, f"{path.relative_to(ROOT)}: schema-owning V1 plugin cannot claim retained-schema uninstall")
    expected = ["manifest", "contracts", "providers", "schema", "behavior", "jobs", "data-handlers", "ui", "admin", "validate", "freeze"]
    if contracts.get("registration", {}).get("phases") != expected:
        fail(errors, "architecture contract registration phases changed without validator migration")


def excluded_from_legacy_scan(relative: Path) -> bool:
    if relative in LEGACY_SCAN_EXCLUSIONS:
        return True
    return len(relative.parts) >= 2 and relative.parts[0] == "docs" and relative.parts[1] == "adr"


def scan_legacy_symbols(contracts: dict[str, Any], errors: list[str]) -> None:
    roots = [ROOT / "README.md", ROOT / "docs", ROOT / "schemas", ROOT / "fixtures", ROOT / ".github"]
    for base in roots:
        paths = [base] if base.is_file() else sorted(base.rglob("*"))
        for path in paths:
            if not path.is_file() or path.suffix not in SCAN_EXTENSIONS:
                continue
            relative = path.relative_to(ROOT)
            if excluded_from_legacy_scan(relative):
                continue
            text = path.read_text(encoding="utf-8")
            for symbol in contracts.get("forbiddenLegacySymbols", []):
                if symbol in text:
                    fail(errors, f"{relative}: forbidden legacy symbol {symbol!r}")


def validate_adr_evidence(errors: list[str]) -> None:
    registry = load_json(EVIDENCE_PATH, errors)
    if not isinstance(registry, dict):
        return
    records = registry.get("records", {})
    levels = set(registry.get("levels", []))
    adr_files = sorted((ROOT / "docs" / "adr").glob("[0-9][0-9][0-9][0-9]-*.md"))
    file_ids = {path.name[:4] for path in adr_files}
    if file_ids - set(records):
        fail(errors, f"ADR evidence registry missing IDs: {sorted(file_ids - set(records))}")
    if set(records) - file_ids:
        fail(errors, f"ADR evidence registry references absent ADRs: {sorted(set(records) - file_ids)}")
    for adr_id, record in records.items():
        if record.get("level") not in levels:
            fail(errors, f"ADR {adr_id}: unknown evidence level {record.get('level')!r}")
        for evidence in record.get("evidence", []):
            if not (ROOT / evidence).exists():
                fail(errors, f"ADR {adr_id}: evidence path does not exist: {evidence}")


def validate_local_markdown_links(errors: list[str]) -> None:
    pattern = re.compile(r"\[[^\]]+\]\((\.{1,2}/[^)#?]+)(?:#[^)]+)?\)")
    for path in sorted((ROOT / "docs").rglob("*.md")):
        for target in pattern.findall(path.read_text(encoding="utf-8")):
            destination = (path.parent / target).resolve()
            try:
                destination.relative_to(ROOT.resolve())
            except ValueError:
                fail(errors, f"{path.relative_to(ROOT)}: link escapes repository: {target}")
                continue
            if not destination.exists():
                fail(errors, f"{path.relative_to(ROOT)}: missing local link target: {target}")


def validate_generated_artifacts(errors: list[str]) -> None:
    generated = ROOT / ".k-nex" / "generated"
    if not generated.exists():
        return
    forbidden_keys = ("generatedAt", "buildTimestamp", "absolutePath", "hostname")
    for path in generated.rglob("*"):
        if path.is_file() and path.suffix in {".json", ".ts"}:
            text = path.read_text(encoding="utf-8")
            for key in forbidden_keys:
                if key in text:
                    fail(errors, f"{path.relative_to(ROOT)}: nondeterministic generated key {key!r}")


def main() -> int:
    errors: list[str] = []
    contracts = load_json(CONTRACTS_PATH, errors)
    load_json(PLUGIN_SCHEMA_PATH, errors)
    load_json(APP_SCHEMA_PATH, errors)
    if isinstance(contracts, dict):
        validate_driver_fixture(contracts, errors)
        scan_legacy_symbols(contracts, errors)
    validate_adr_evidence(errors)
    validate_local_markdown_links(errors)
    validate_generated_artifacts(errors)
    if errors:
        print("Architecture contract validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Architecture contracts, fixtures, links, ADR evidence, and legacy-symbol checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
