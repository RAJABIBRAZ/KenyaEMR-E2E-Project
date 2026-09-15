#!/usr/bin/env python3
"""Local audit log for synthetic UAT patient identifiers assigned by UAT."""

from __future__ import annotations

import csv
import fcntl
import json
import os
import re
import secrets
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PATH = PROJECT_ROOT / "tracker-data" / "uat-patient-events.jsonl"
SCHEMA_VERSION = 1
MAX_INPUT_BYTES = 4096
INPUT_FIELDS = {
    "run_id",
    "module",
    "test_name",
    "source_key",
    "fixture_key",
    "status",
    "patient_identifier",
    "patient_uuid",
    "failure_code",
}
CSV_FIELDS = [
    "schema_version",
    "event_id",
    "recorded_at",
    "run_id",
    "module",
    "test_name",
    "source_key",
    "fixture_key",
    "status",
    "patient_identifier",
    "patient_uuid",
    "failure_code",
]
UUID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
FIXTURE_PATTERN = re.compile(r"^QAE2E-[A-Z0-9-]{1,94}$")
FAILURE_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
RUN_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,100}$")


def tracker_path() -> Path:
    configured = os.environ.get("QA_PATIENT_TRACKER_PATH")
    if not configured:
        return DEFAULT_PATH
    path = Path(configured).expanduser()
    if not path.is_absolute():
        raise ValueError("QA_PATIENT_TRACKER_PATH must be an absolute path")
    return path


def _ensure_parent_directory(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.parent == DEFAULT_PATH.parent:
        path.parent.chmod(0o700)


def _text(data: dict, field: str, limit: int, required: bool = False) -> str | None:
    value = data.get(field)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value or len(value) > limit:
        raise ValueError(field + " must be a non-empty string of at most " + str(limit) + " characters")
    if value != value.strip() or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError(field + " must not contain leading/trailing whitespace or control characters")
    return value


def validate_record(data: object) -> dict:
    if not isinstance(data, dict):
        raise ValueError("record must be a JSON object")
    unknown = set(data) - INPUT_FIELDS
    if unknown:
        raise ValueError("record contains unsupported fields; demographics and raw errors are not stored")

    run_id = _text(data, "run_id", 100, required=True)
    module = _text(data, "module", 100, required=True)
    test_name = _text(data, "test_name", 255, required=True)
    source_key = _text(data, "source_key", 100)
    fixture_key = _text(data, "fixture_key", 100, required=True)
    status = _text(data, "status", 20, required=True)
    identifier = _text(data, "patient_identifier", 100)
    patient_uuid = _text(data, "patient_uuid", 36)
    failure_code = _text(data, "failure_code", 64)

    if not RUN_PATTERN.fullmatch(run_id):
        raise ValueError("run_id contains unsupported characters")
    if not FIXTURE_PATTERN.fullmatch(fixture_key):
        raise ValueError("fixture_key must begin QAE2E- and use uppercase letters, numbers, or hyphens")
    if status not in {"CREATED", "OBSERVED", "FAILED"}:
        raise ValueError("status must be CREATED, OBSERVED, or FAILED")
    if status in {"CREATED", "OBSERVED"} and identifier is None:
        raise ValueError("patient_identifier is required for CREATED and OBSERVED events")
    if patient_uuid is not None and not UUID_PATTERN.fullmatch(patient_uuid):
        raise ValueError("patient_uuid must be a canonical UUID")
    if failure_code is not None and not FAILURE_PATTERN.fullmatch(failure_code):
        raise ValueError("failure_code must be an uppercase code without free text")
    if status != "FAILED" and failure_code is not None:
        raise ValueError("failure_code is only valid for FAILED events")

    return {
        "schema_version": SCHEMA_VERSION,
        "event_id": uuid.uuid4().hex,
        "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "run_id": run_id,
        "module": module,
        "test_name": test_name,
        "source_key": source_key,
        "fixture_key": fixture_key,
        "status": status,
        "patient_identifier": identifier,
        "patient_uuid": patient_uuid,
        "failure_code": failure_code,
    }


def record_event(path: Path, data: object) -> dict:
    event = validate_record(data)
    _ensure_parent_directory(path)
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_APPEND, 0o600)
    with os.fdopen(descriptor, "r+", encoding="utf-8", newline="") as output:
        os.fchmod(output.fileno(), 0o600)
        fcntl.flock(output.fileno(), fcntl.LOCK_EX)
        try:
            output.seek(0, os.SEEK_END)
            size = output.tell()
            if size:
                output.seek(size - 1)
                if output.read(1) != "\n":
                    raise ValueError("tracker has an incomplete final JSONL line; repair before appending")
            output.seek(0, os.SEEK_END)
            output.write(json.dumps(event, ensure_ascii=True, separators=(",", ":")) + "\n")
            output.flush()
            os.fsync(output.fileno())
        finally:
            fcntl.flock(output.fileno(), fcntl.LOCK_UN)
    return event


def read_events(path: Path) -> list[dict]:
    if not path.exists():
        return []
    records = []
    with path.open("r", encoding="utf-8", newline="") as source:
        fcntl.flock(source.fileno(), fcntl.LOCK_SH)
        try:
            for line_number, line in enumerate(source, start=1):
                if not line.endswith("\n"):
                    raise ValueError("tracker line " + str(line_number) + " is incomplete")
                try:
                    event = json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError("tracker line " + str(line_number) + " is invalid JSON") from error
                if not isinstance(event, dict) or event.get("schema_version") != SCHEMA_VERSION:
                    raise ValueError("tracker line " + str(line_number) + " has an unsupported schema")
                records.append(event)
        finally:
            fcntl.flock(source.fileno(), fcntl.LOCK_UN)
    return records


def _excel_safe(value: object) -> str:
    if value is None:
        return ""
    cell = str(value)
    if re.match(r"^\s*[=+\-@]", cell):
        return "'" + cell
    return cell


def export_csv(path: Path) -> tuple[Path, int]:
    output_path = path.with_suffix(".csv")
    records = read_events(path)
    _ensure_parent_directory(output_path)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".uat-patient-events.", suffix=".csv", dir=output_path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as output:
            os.fchmod(output.fileno(), 0o600)
            writer = csv.DictWriter(output, fieldnames=CSV_FIELDS, extrasaction="ignore")
            writer.writeheader()
            for record in records:
                writer.writerow({field: _excel_safe(record.get(field)) for field in CSV_FIELDS})
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_name, output_path)
    except Exception:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
        raise
    return output_path, len(records)


def new_run_id() -> str:
    return "E2E-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(4)


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in {"record", "export", "new-run-id"}:
        print("usage: uat_patient_tracker.py {record|export|new-run-id}", file=sys.stderr)
        return 2
    command = sys.argv[1]
    try:
        if command == "new-run-id":
            print(new_run_id())
            return 0
        path = tracker_path()
        if command == "record":
            raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
            if len(raw) > MAX_INPUT_BYTES:
                raise ValueError("record exceeds the size limit")
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError as error:
                raise ValueError("record input is invalid JSON") from error
            event = record_event(path, payload)
            print(event["event_id"])
            return 0
        output_path, count = export_csv(path)
        print(str(output_path) + " (" + str(count) + " events)")
        return 0
    except (OSError, ValueError) as error:
        print("tracker error: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
