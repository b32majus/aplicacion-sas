from __future__ import annotations

import hashlib
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import parse_sas_exam as importer
import publish_exam

BANK = ROOT / "app/public/data/exams"
EXAM_ID = "sas-administrativo-2021-turno-libre"
SOURCE_FIXTURE = ROOT / "tests/fixtures/publication" / f"{EXAM_ID}.source.json"


def load_current() -> dict:
    catalog = json.loads((BANK / "catalog.json").read_text(encoding="utf-8"))
    entry = next(item for item in catalog["exams"] if item["id"] == EXAM_ID)
    return json.loads((BANK / entry["latestPath"]).read_text(encoding="utf-8"))


def reversion(exam: dict) -> None:
    content_hash = importer.canonical_content_sha256(exam)
    exam["version"]["contentSha256"] = content_hash
    exam["version"]["id"] = hashlib.sha256(
        f"{exam['source']['sha256']}:{content_hash}".encode("ascii")
    ).hexdigest()


class TestExamPublication(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="exam-publication-")
        self.root = Path(self.temp.name)
        self.bank = self.root / "bank"
        shutil.copytree(BANK, self.bank)
        self.exam_path = self.root / f"{EXAM_ID}.json"
        self.metadata_path = self.root / f"{EXAM_ID}.source.json"
        self.metadata_path.write_bytes(SOURCE_FIXTURE.read_bytes())
        self.summary = self.root / "summary.md"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_exam(self, exam: dict) -> None:
        self.exam_path.write_text(json.dumps(exam, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def snapshot(self, directory: Path) -> dict[str, bytes]:
        return {
            path.relative_to(directory).as_posix(): path.read_bytes()
            for path in directory.rglob("*")
            if path.is_file()
        }

    def test_correction_prepares_reviewable_proposal_without_touching_source_bank(self) -> None:
        source_before = self.snapshot(BANK)
        old_catalog = json.loads((self.bank / "catalog.json").read_text(encoding="utf-8"))
        old_entry = next(item for item in old_catalog["exams"] if item["id"] == EXAM_ID)
        old_version = self.bank / old_entry["latestPath"]
        old_bytes = old_version.read_bytes()
        corrected = load_current()
        corrected["title"] += " - corrección controlada"
        reversion(corrected)
        self.write_exam(corrected)

        values = publish_exam.prepare(
            self.exam_path, self.metadata_path, self.bank, self.summary
        )

        self.assertEqual(values["version"], corrected["version"]["id"])
        catalog = json.loads((self.bank / "catalog.json").read_text(encoding="utf-8"))
        entry = next(item for item in catalog["exams"] if item["id"] == EXAM_ID)
        self.assertEqual(entry["latestVersion"], corrected["version"]["id"])
        self.assertTrue(old_version.exists())
        self.assertEqual(old_version.read_bytes(), old_bytes)
        self.assertEqual(self.snapshot(BANK), source_before)
        summary = self.summary.read_text(encoding="utf-8")
        for expected in (
            EXAM_ID,
            corrected["source"]["sha256"],
            corrected["version"]["id"],
            "Activas",
            "Anuladas",
            "Reservas utilizadas",
            "Reservas no utilizadas",
            "Duración",
            "Incidencias QA",
            "solo el merge humano publica",
        ):
            self.assertIn(expected, summary)
        publish_exam.verify_bank(self.bank)

    def test_invalid_package_is_blocked_before_any_bank_change(self) -> None:
        exam = load_current()
        exam["scorableSet"]["count"] -= 1
        self.write_exam(exam)
        before = self.snapshot(self.bank)
        with self.assertRaisesRegex(publish_exam.PublicationBlockedError, "contenido canónico|recuentos"):
            publish_exam.prepare(self.exam_path, self.metadata_path, self.bank, self.summary)
        self.assertEqual(self.snapshot(self.bank), before)
        self.assertFalse(self.summary.exists())

    def test_blocked_canonical_state_cannot_update_catalog(self) -> None:
        blocked_path = next((BANK / "blocked").glob("*/versions/*.json"))
        blocked = json.loads(blocked_path.read_text(encoding="utf-8"))
        self.write_exam(blocked)
        metadata = json.loads(SOURCE_FIXTURE.read_text(encoding="utf-8"))
        metadata["examId"] = blocked["id"]
        metadata["officialSource"]["sha256"] = blocked["source"]["sha256"]
        self.metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
        before = self.snapshot(self.bank)
        with self.assertRaisesRegex(publish_exam.PublicationBlockedError, "bloqueado_para_revision"):
            publish_exam.prepare(self.exam_path, self.metadata_path, self.bank, self.summary)
        self.assertEqual(self.snapshot(self.bank), before)

    def test_source_hash_mismatch_and_secret_bearing_url_are_rejected(self) -> None:
        exam = load_current()
        self.write_exam(exam)
        metadata = json.loads(SOURCE_FIXTURE.read_text(encoding="utf-8"))
        metadata["officialSource"]["sha256"] = "0" * 64
        self.metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
        with self.assertRaisesRegex(publish_exam.PublicationBlockedError, "no coincide"):
            publish_exam.prepare(self.exam_path, self.metadata_path, self.bank, self.summary)

        metadata["officialSource"]["sha256"] = exam["source"]["sha256"]
        metadata["officialSource"]["reference"] = "https://official.example/exam?token=secret"
        self.metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
        with self.assertRaisesRegex(publish_exam.PublicationBlockedError, "query"):
            publish_exam.prepare(self.exam_path, self.metadata_path, self.bank, self.summary)

    def test_unchanged_input_is_idempotent_and_does_not_duplicate_version(self) -> None:
        exam = load_current()
        self.write_exam(exam)
        before = self.snapshot(self.bank)
        publish_exam.prepare(self.exam_path, self.metadata_path, self.bank, self.summary)
        self.assertEqual(self.snapshot(self.bank), before)
        versions = list((self.bank / EXAM_ID / "versions").glob(f"{exam['version']['id']}.json"))
        self.assertEqual(len(versions), 1)

    def test_verify_bank_rejects_tampered_qa(self) -> None:
        qa_path = next(self.bank.glob("*/versions/*.qa.md"))
        qa_path.write_text("QA alterado\n", encoding="utf-8")
        with self.assertRaisesRegex(publish_exam.PublicationBlockedError, "QA versionado"):
            publish_exam.verify_bank(self.bank)

    def test_fixture_pair_uses_existing_t01_canonical_package(self) -> None:
        exam = load_current()
        metadata = json.loads(SOURCE_FIXTURE.read_text(encoding="utf-8"))
        reference = publish_exam.validate_source_metadata(metadata, exam, SOURCE_FIXTURE)
        self.assertTrue(reference.startswith("https://"))
        importer.validate_exam_package(exam)

    def test_input_check_rejects_incomplete_pairs(self) -> None:
        inputs = self.root / "inputs"
        inputs.mkdir()
        self.write_exam(load_current())
        shutil.copy2(self.exam_path, inputs / f"{EXAM_ID}.json")
        with self.assertRaisesRegex(publish_exam.PublicationBlockedError, "pares de entrada incompletos"):
            publish_exam.verify_inputs(inputs)

        shutil.copy2(SOURCE_FIXTURE, inputs / f"{EXAM_ID}.source.json")
        publish_exam.verify_inputs(inputs)

    def test_immutable_check_rejects_changed_or_deleted_versions(self) -> None:
        diff = (
            "M\tapp/public/data/exams/exam/versions/old.json\n"
            "D\tapp/public/data/exams/exam/versions/old.qa.md\n"
        )
        completed = type("Completed", (), {"stdout": diff})()
        with mock.patch.object(publish_exam.subprocess, "run", return_value=completed):
            with self.assertRaisesRegex(publish_exam.PublicationBlockedError, "inmutables"):
                publish_exam.verify_immutable_changes("base", BANK)


if __name__ == "__main__":
    unittest.main(verbosity=2)
