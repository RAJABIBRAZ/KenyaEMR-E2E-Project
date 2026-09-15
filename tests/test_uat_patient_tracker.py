import csv
import json
import os
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "tools"))
import uat_patient_tracker as tracker  # noqa: E402


class UatPatientTrackerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "uat-patient-events.jsonl"
        self.sample = {
            "run_id": "E2E-20260915-104612-a81f0000",
            "module": "Registration",
            "test_name": "Register synthetic patient",
            "source_key": "03_Registration!R2",
            "fixture_key": "QAE2E-REG-001",
            "status": "CREATED",
            "patient_identifier": "UAT-12345",
            "patient_uuid": "00000000-0000-4000-8000-000000000001",
        }

    def tearDown(self):
        self.directory.cleanup()

    def test_created_event_records_uat_identifier_and_exports_csv(self):
        event = tracker.record_event(self.path, self.sample)
        self.assertEqual(event["patient_identifier"], "UAT-12345")
        self.assertEqual(event["status"], "CREATED")
        self.assertEqual(len(tracker.read_events(self.path)), 1)
        csv_path, count = tracker.export_csv(self.path)
        self.assertEqual(count, 1)
        with csv_path.open(newline="", encoding="utf-8") as source:
            rows = list(csv.DictReader(source))
        self.assertEqual(rows[0]["patient_identifier"], "UAT-12345")
        self.assertEqual(rows[0]["patient_uuid"], self.sample["patient_uuid"])

    def test_failed_event_can_be_logged_without_an_assigned_identifier(self):
        failed = {
            **self.sample,
            "status": "FAILED",
            "patient_identifier": None,
            "patient_uuid": None,
            "failure_code": "REGISTRATION_TIMEOUT",
        }
        tracker.record_event(self.path, failed)
        self.assertEqual(tracker.read_events(self.path)[0]["failure_code"], "REGISTRATION_TIMEOUT")

    def test_rejects_missing_success_identifier_and_unexpected_patient_data(self):
        with self.assertRaises(ValueError):
            tracker.validate_record({**self.sample, "patient_identifier": None})
        with self.assertRaises(ValueError):
            tracker.validate_record({**self.sample, "phone": "0700000001"})
        with self.assertRaises(ValueError):
            tracker.validate_record({**self.sample, "fixture_key": "MANUAL-PATIENT"})

    def test_csv_neutralizes_formula_like_identifier(self):
        tracker.record_event(self.path, {**self.sample, "patient_identifier": "=2+2"})
        csv_path, _ = tracker.export_csv(self.path)
        with csv_path.open(newline="", encoding="utf-8") as source:
            row = next(csv.DictReader(source))
        self.assertEqual(row["patient_identifier"], "'=2+2")
        self.assertEqual(tracker.read_events(self.path)[0]["patient_identifier"], "=2+2")

    def test_parallel_processes_append_complete_jsonl_events(self):
        environment = {**os.environ, "QA_PATIENT_TRACKER_PATH": str(self.path)}

        def write_one(index):
            payload = {
                **self.sample,
                "fixture_key": "QAE2E-REG-" + str(index).zfill(3),
                "patient_identifier": "UAT-" + str(index).zfill(5),
            }
            return subprocess.run(
                [sys.executable, str(PROJECT_ROOT / "tools" / "uat_patient_tracker.py"), "record"],
                input=json.dumps(payload),
                capture_output=True,
                text=True,
                env=environment,
                check=False,
            )

        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(write_one, range(1, 25)))
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
        events = tracker.read_events(self.path)
        self.assertEqual(len(events), 24)
        self.assertEqual(len({event["event_id"] for event in events}), 24)
        self.assertEqual(len({event["patient_identifier"] for event in events}), 24)

    def test_incomplete_line_is_not_silently_extended(self):
        self.path.write_text('{"schema_version":1}', encoding="utf-8")
        with self.assertRaises(ValueError):
            tracker.record_event(self.path, self.sample)


if __name__ == "__main__":
    unittest.main()
