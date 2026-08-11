#!/usr/bin/env python3
"""Truth test Seam 1: el importador real sobre los 12 PDF oficiales locales.

Caja negra sobre `scripts/parse_sas_exam.py`:
- los 12 PDF clasifican de forma determinista (publicable o bloqueado con motivo);
- todo paquete emitido valida contra el schema canónico y los invariantes de dominio;
- la misma entrada produce exactamente la misma salida (determinismo);
- la versión inmutable combina la traza SHA-256 de fuente y contenido final;
- las ambigüedades bloquean explícitamente (con PDFs sintéticos reales);
- la anomalía 2023 pregunta 35 se reporta sin corregir;
- al menos un paquete publicable es fixture consumible por Seam 2.

Ejecución:
    .venv/bin/python -m unittest -v tests/test_import_sas_bank.py
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import fitz  # PyMuPDF
import parse_sas_exam as importer

FIXTURES_DIR = ROOT / ".kairos-fixtures"
BANK_DIR = ROOT / "app" / "public" / "data" / "exams"
CATALOG_PATH = BANK_DIR / "catalog.json"
REAL_SEAM2_EXAM_ID = "sas-administrativo-2021-turno-libre"

EXPECTED_FIXTURES = [
    "Examen_ADM_PI_2015.pdf",
    "Examen_ADM_PI_2018.pdf",
    "Examen_ADM_PI_2021.pdf",
    "Examen_ADM_PI_2025.pdf",
    "Examen_ADM_L_2015.pdf",
    "Examen_ADM_L_2018.pdf",
    "Examen_ADM_L_2021.pdf",
    "Examen_ADM_L_2023.pdf",
    "Examen_ADM_L_2025.pdf",
    "Examen_ADM_PI_AP_2021.pdf",
    "Examen_ADM_L_AP_2021.pdf",
    "Examen_ADM_L_APL_2015.pdf",
]


def require_real_pdf_fixtures(fixtures_dir: Path) -> None:
    missing = [name for name in EXPECTED_FIXTURES if not (fixtures_dir / name).is_file()]
    if missing:
        raise unittest.SkipTest(
            "12 PDF oficiales no disponibles; se omite solo TestRealPdfs: "
            + ", ".join(missing)
        )


def canonical_json(exam: dict) -> str:
    return json.dumps(exam, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def load_real_seam2_package() -> dict:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    entry = next(item for item in catalog["exams"] if item["id"] == REAL_SEAM2_EXAM_ID)
    return json.loads((BANK_DIR / entry["latestPath"]).read_text(encoding="utf-8"))


def published_snapshot(outdir: Path) -> dict[str, bytes]:
    return {
        path.relative_to(outdir).as_posix(): path.read_bytes()
        for path in outdir.rglob("*")
        if path.is_file()
    }


# --------------------------------------------------------------------------
# PDFs sintéticos para probar el bloqueo explícito con el importador real
# --------------------------------------------------------------------------

def synthetic_exam_pdf(
    path: Path,
    questions: list[tuple[int, str, list[str]]],
    answers: dict[int, str],
    *,
    cover_extra: str = "",
    key_extra: str = "",
    declared_ordinary_end: int | None = None,
) -> None:
    """Construye un PDF real con el mismo esqueleto que los oficiales.

    questions: (número, texto, [4 opciones]).
    answers: {número: "A".."D" | "ANULADA"}.
    """
    doc = fitz.open()
    page = doc.new_page()

    ordinary_numbers = sorted({number for number, _, _ in questions if number <= 150})
    reserve_numbers = sorted({number for number, _, _ in questions if number > 150})
    ordinary_end = declared_ordinary_end or max(ordinary_numbers)
    range_line = (
        f"Esta prueba consta de {len(ordinary_numbers)} preguntas, "
        f"numeradas de la {min(ordinary_numbers)} a la {ordinary_end}"
    )
    if reserve_numbers:
        range_line += (
            ", y preguntas de reserva, "
            f"numeradas de la {min(reserve_numbers)} a la {max(reserve_numbers)}."
        )
    else:
        range_line += "."
    cover_lines = [
        "El tiempo de duración de la prueba es de dos horas.",
        "ACCESO: LIBRE",
        range_line,
        "ADMINISTRATIVO/A 2099",
    ]
    if cover_extra:
        cover_lines.append(cover_extra)
    y = 72
    for line in cover_lines:
        page.insert_text((72, y), line, fontsize=10)
        y += 16

    page = doc.new_page()
    y = 72
    for number, text, options in questions:
        page.insert_text((72, y), str(number), fontsize=10)
        y += 16
        page.insert_text((72, y), text, fontsize=10)
        y += 16
        for option in options:
            page.insert_text((72, y), option, fontsize=10)
            y += 16
        y += 8

    page = doc.new_page()
    key_lines = ["Plantilla de Respuestas", "DEFINITIVA", "Orden Examen Respuesta Correcta"]
    for number in sorted(answers):
        key_lines.append(str(number))
        key_lines.append(str(answers[number]))  # número y letra en líneas distintas, como en la fuente
    if key_extra:
        key_lines.append(key_extra)
    y = 72
    for line in key_lines:
        page.insert_text((72, y), line, fontsize=10)
        y += 16

    doc.save(str(path), no_new_id=True, reproducible=True)
    doc.close()


def four_options(letters: list[str] | None = None) -> list[str]:
    letters = letters or ["A", "B", "C", "D"]
    return [f"{letter}) Opción {letter}" for letter in letters]


def make_synthetic(questions: list[tuple[int, str, list[str]]], answers: dict[int, str], **kwargs) -> Path:
    tmp = tempfile.mkdtemp(prefix="sas-synth-")
    path = Path(tmp) / "sintetico.pdf"
    synthetic_exam_pdf(path, questions, answers, **kwargs)
    return path


def run_import(pdf: Path, outdir: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "import_sas_exam.py"), str(pdf), str(outdir)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


class TestSyntheticBlocking(unittest.TestCase):
    """Bloqueo explícito ante ambigüedad, sin adivinar."""

    def test_clean_synthetic_is_publicable(self) -> None:
        questions = [
            (1, "¿Pregunta uno?", four_options()),
            (2, "¿Pregunta dos?", four_options()),
            (3, "¿Pregunta tres?", four_options()),
            (151, "¿Reserva?", four_options()),
        ]
        answers = {1: "A", 2: "B", 3: "C", 151: "D"}
        pdf = make_synthetic(questions, answers)
        result = importer.build_exam(pdf)
        self.assertEqual(result.state, importer.PUBLICABLE, result.blocked_reason)
        self.assertIsNotNone(result.exam)
        reserve = [q for q in result.exam["questions"] if q["sourceNumber"] == 151][0]
        self.assertEqual(reserve["status"], "reserve")
        self.assertFalse(reserve["active"])  # sin evidencia de uso: inactiva

    def test_generic_instruction_to_answer_reserves_does_not_justify_substitution(self) -> None:
        questions = [
            (1, "¿Pregunta anulada?", four_options()),
            (2, "¿Pregunta válida?", four_options()),
            (151, "¿Primera reserva?", four_options()),
            (152, "¿Segunda reserva?", four_options()),
        ]
        pdf = make_synthetic(
            questions,
            {1: "ANULADA", 2: "B", 151: "C", 152: "D"},
            cover_extra=(
                "Las preguntas de reserva deben ser contestadas en la zona destinada "
                "a Reserva de la Hoja de Respuestas."
            ),
        )
        result = importer.build_exam(pdf)
        self.assertEqual(result.state, importer.BLOCKED)
        self.assertIn("evidencia explícita y específica", result.blocked_reason)

    def test_explicit_exam_specific_substitution_activates_exact_reserve(self) -> None:
        questions = [
            (1, "¿Pregunta anulada?", four_options()),
            (2, "¿Pregunta válida?", four_options()),
            (151, "¿Primera reserva?", four_options()),
            (152, "¿Segunda reserva?", four_options()),
        ]
        pdf = make_synthetic(
            questions,
            {1: "ANULADA", 2: "B", 151: "C", 152: "D"},
            key_extra="La pregunta de reserva 151 sustituye a la pregunta anulada 1.",
        )
        result = importer.build_exam(pdf)
        self.assertEqual(result.state, importer.PUBLICABLE, result.blocked_reason)
        by_number = {q["sourceNumber"]: q for q in result.exam["questions"]}
        self.assertFalse(by_number[1]["active"])
        self.assertTrue(by_number[151]["active"])
        self.assertEqual(by_number[151]["displayLabel"], "R1")
        self.assertFalse(by_number[152]["active"])
        self.assertEqual(result.exam["scorableSet"]["reserveUsedNumbers"], [151])

    def test_all_declared_reserves_are_certain_when_all_are_needed(self) -> None:
        questions = [
            (1, "¿Pregunta anulada?", four_options()),
            (2, "¿Pregunta válida?", four_options()),
            (151, "¿Reserva?", four_options()),
        ]
        pdf = make_synthetic(
            questions,
            {1: "ANULADA", 2: "B", 151: "C"},
            cover_extra=(
                "Las preguntas de reserva deben ser contestadas en la zona destinada "
                "a Reserva, numeradas de la 151 a la 151."
            ),
        )
        result = importer.build_exam(pdf)
        self.assertEqual(result.state, importer.PUBLICABLE, result.blocked_reason)
        self.assertEqual(result.exam["scorableSet"]["reserveUsedNumbers"], [151])
        self.assertEqual(result.exam["scorableSet"]["questionNumbers"], [2, 151])
        self.assertEqual(
            result.exam["scorableSet"]["reserveUseEvidence"]["basis"],
            "all_declared_reserves_required",
        )

    def test_more_annulments_than_declared_reserves_blocks(self) -> None:
        questions = [
            (1, "¿Primera anulada?", four_options()),
            (2, "¿Segunda anulada?", four_options()),
            (151, "¿Única reserva?", four_options()),
        ]
        pdf = make_synthetic(
            questions,
            {1: "ANULADA", 2: "ANULADA", 151: "C"},
            cover_extra=(
                "Las preguntas de reserva deben ser contestadas en la zona destinada "
                "a Reserva de la Hoja de Respuestas."
            ),
        )
        result = importer.build_exam(pdf)
        self.assertEqual(result.state, importer.BLOCKED)
        self.assertIn("reservas insuficientes", result.blocked_reason)

    def test_missing_answer_blocks(self) -> None:
        questions = [
            (1, "¿Pregunta uno?", four_options()),
            (2, "¿Pregunta dos?", four_options()),
        ]
        answers = {1: "A"}  # falta la respuesta de la 2
        pdf = make_synthetic(questions, answers)
        result = importer.build_exam(pdf)
        self.assertEqual(result.state, importer.BLOCKED)
        self.assertIsNotNone(result.exam)
        importer.validate_exam_package(result.exam, pdf)
        self.assertEqual(result.exam["scorableSet"]["state"], "unresolved")
        self.assertEqual(result.exam["scorableSet"]["questionNumbers"], [])
        self.assertTrue(all(not question["active"] for question in result.exam["questions"]))
        self.assertIn("recuento irreconciliable", result.blocked_reason)

    def test_declared_question_range_mismatch_blocks(self) -> None:
        questions = [
            (1, "¿Pregunta uno?", four_options()),
            (2, "¿Pregunta dos?", four_options()),
            (3, "¿Pregunta tres?", four_options()),
        ]
        pdf = make_synthetic(
            questions,
            {1: "A", 2: "B", 3: "C"},
            declared_ordinary_end=150,
        )
        result = importer.build_exam(pdf)
        self.assertEqual(result.state, importer.BLOCKED)
        self.assertIn("rangos del cuadernillo", result.blocked_reason)

    def test_bad_options_block(self) -> None:
        questions = [
            (1, "¿Pregunta uno?", four_options()),
            (2, "¿Pregunta dos?", ["A) Una", "B) Dos", "C) Tres"]),  # solo 3 opciones
        ]
        answers = {1: "A", 2: "C"}
        pdf = make_synthetic(questions, answers)
        result = importer.build_exam(pdf)
        self.assertEqual(result.state, importer.BLOCKED)
        self.assertIn("4 opciones A-D", result.blocked_reason)

    def test_answer_without_option_blocks(self) -> None:
        questions = [
            (1, "¿Pregunta uno?", four_options()),
            (2, "¿Pregunta dos?", four_options()),
        ]
        answers = {1: "A", 2: "E"}  # respuesta E sin opción E
        pdf = make_synthetic(questions, answers)
        result = importer.build_exam(pdf)
        self.assertEqual(result.state, importer.BLOCKED)
        self.assertIn("sin opción correspondiente", result.blocked_reason)

    def test_duplicate_with_different_content_blocks(self) -> None:
        questions = [
            (1, "¿Pregunta uno?", four_options()),
            (2, "¿Versión A de la dos?", four_options()),
            (2, "¿Versión B de la dos?", four_options()),
            (3, "¿Pregunta tres?", four_options()),
        ]
        answers = {1: "A", 2: "B", 3: "C"}
        pdf = make_synthetic(questions, answers)
        result = importer.build_exam(pdf)
        self.assertEqual(result.state, importer.BLOCKED)
        self.assertIn("contenido distinto", result.blocked_reason)

    def test_missing_answer_key_blocks(self) -> None:
        questions = [(1, "¿Pregunta uno?", four_options())]
        answers = {1: "A"}
        pdf = make_synthetic(questions, answers)
        # Al eliminar "Plantilla" y "ANULAD" de todas las páginas, no hay clave.
        doc = fitz.open(str(pdf))
        for i in range(len(doc) - 1, -1, -1):
            text = doc[i].get_text("text")
            if "Plantilla" in text or "ANULAD" in text.upper():
                doc.delete_page(i)
        stripped = Path(str(pdf) + ".nostripped.pdf")
        doc.save(str(stripped))
        doc.close()
        result = importer.build_exam(stripped)
        self.assertEqual(result.state, importer.BLOCKED)
        self.assertIn("plantilla oficial", result.blocked_reason)

    def test_identical_duplicate_is_deduplicated_with_flag(self) -> None:
        questions = [
            (1, "¿Pregunta uno?", four_options()),
            (2, "¿Pregunta dos?", four_options()),
            (2, "¿Pregunta dos?", four_options()),  # copia idéntica (capa de texto)
            (3, "¿Pregunta tres?", four_options()),
        ]
        answers = {1: "A", 2: "B", 3: "C"}
        pdf = make_synthetic(questions, answers)
        result = importer.build_exam(pdf)
        self.assertEqual(result.state, importer.PUBLICABLE)
        flags = result.exam["qa"]["flags"]
        self.assertTrue(any("question_duplicated_in_source_text_layer" in f["flag"] for f in flags))


class TestRealFixtureAvailability(unittest.TestCase):
    def test_missing_corpus_skips_with_an_explicit_reason(self) -> None:
        with tempfile.TemporaryDirectory(prefix="missing-real-pdfs-") as directory:
            with self.assertRaisesRegex(unittest.SkipTest, "12 PDF oficiales"):
                require_real_pdf_fixtures(Path(directory))
            with mock.patch.object(sys.modules[__name__], "FIXTURES_DIR", Path(directory)):
                with self.assertRaisesRegex(unittest.SkipTest, "solo TestRealPdfs"):
                    TestRealPdfs.setUpClass()

    def test_complete_corpus_remains_enabled(self) -> None:
        with tempfile.TemporaryDirectory(prefix="complete-real-pdfs-") as directory:
            fixtures = Path(directory)
            for name in EXPECTED_FIXTURES:
                (fixtures / name).touch()
            require_real_pdf_fixtures(fixtures)


class TestRealPdfs(unittest.TestCase):
    """Los 12 PDF oficiales: clasificación determinista, schema e invariantes."""

    @classmethod
    def setUpClass(cls) -> None:
        require_real_pdf_fixtures(FIXTURES_DIR)
        cls.results = {}
        for name in EXPECTED_FIXTURES:
            cls.results[name] = importer.build_exam(FIXTURES_DIR / name)
        cls.packages = {
            name: result.exam
            for name, result in cls.results.items()
            if result.exam is not None
        }
        cls.exams = {
            name: result.exam
            for name, result in cls.results.items()
            if result.state == importer.PUBLICABLE
        }

    def test_all_12_classify_deterministically(self) -> None:
        self.assertEqual(len(self.results), 12)
        for name, result in self.results.items():
            self.assertIn(result.state, {importer.PUBLICABLE, importer.BLOCKED}, name)
            if result.state == importer.BLOCKED:
                self.assertTrue(result.blocked_reason, name)
                self.assertIsNotNone(result.exam, name)
                self.assertEqual(result.exam["qa"]["state"], importer.BLOCKED, name)
                self.assertEqual(result.exam["scorableSet"]["state"], "unresolved", name)
                self.assertEqual(result.exam["scorableSet"]["questionNumbers"], [], name)
                self.assertEqual(result.exam["scorableSet"]["count"], 0, name)
                self.assertTrue(all(not question["active"] for question in result.exam["questions"]), name)
            importer.validate_exam_package(result.exam, FIXTURES_DIR / name)
            # determinismo: reimportar produce la misma clasificación
            again = importer.build_exam(FIXTURES_DIR / name)
            self.assertEqual(again.state, result.state, name)
            self.assertEqual(canonical_json(again.exam), canonical_json(result.exam), name)
        self.assertEqual(len(self.packages), 12)
        self.assertEqual(set(self.exams), {
            "Examen_ADM_PI_2018.pdf",
            "Examen_ADM_L_2021.pdf",
        })
        self.assertEqual(self.results["Examen_ADM_L_2018.pdf"].state, importer.BLOCKED)
        self.assertIn(
            "reservas insuficientes",
            self.results["Examen_ADM_L_2018.pdf"].blocked_reason,
        )
        for name, exam in self.exams.items():
            self.assertEqual(exam["scorableSet"]["reserveUsedNumbers"], [151, 152, 153], name)
            self.assertEqual(exam["scorableSet"]["count"], 150, name)
        for name, result in self.results.items():
            if name not in self.exams and name != "Examen_ADM_L_2018.pdf":
                self.assertIn("evidencia explícita y específica", result.blocked_reason, name)

    def test_real_seam2_package_validates_through_public_validator(self) -> None:
        exam = load_real_seam2_package()
        importer.validate_exam_package(exam, FIXTURES_DIR / exam["source"]["pdf"])

        three_options = json.loads(canonical_json(exam))
        three_options["questions"][0]["options"].pop()
        with self.assertRaises(importer.CanonicalPackageError):
            importer.validate_exam_package(three_options)

        wrong_option_id = json.loads(canonical_json(exam))
        wrong_option_id["questions"][0]["options"][3]["id"] = "E"
        with self.assertRaises(importer.CanonicalPackageError):
            importer.validate_exam_package(wrong_option_id)

        blocked = self.results["Examen_ADM_L_2023.pdf"].exam
        importer.validate_exam_package(blocked, FIXTURES_DIR / blocked["source"]["pdf"])
        active_blocked = json.loads(canonical_json(blocked))
        active_blocked["questions"][0]["active"] = True
        with self.assertRaisesRegex(
            importer.CanonicalPackageError, "schema canónico inválido|bloqueada activa"
        ):
            importer.validate_exam_package(active_blocked)

    def test_published_real_reserve_evidence_is_auditable_and_cross_field_valid(self) -> None:
        expected_annulled = {
            "sas-administrativo-2018-promocion-interna": [24, 56, 111],
            "sas-administrativo-2021-turno-libre": [13, 14, 69],
        }
        catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        self.assertEqual({entry["id"] for entry in catalog["exams"]}, set(expected_annulled))
        for entry in catalog["exams"]:
            with self.subTest(exam=entry["id"]):
                exam = json.loads((BANK_DIR / entry["latestPath"]).read_text(encoding="utf-8"))
                evidence = exam["scorableSet"]["reserveUseEvidence"]
                self.assertEqual(evidence["basis"], "all_declared_reserves_required")
                self.assertEqual(evidence["sourcePages"], [1, 37])
                self.assertEqual(evidence["reserveDeclarationPage"], 1)
                self.assertEqual(evidence["reserveInstructionPage"], 1)
                self.assertEqual(evidence["definitiveAnswerKeyPage"], 37)
                self.assertEqual(evidence["sourceDeclaredReserveNumbers"], [151, 152, 153])
                self.assertEqual(
                    evidence["definitiveKeyAnnulledNumbers"], expected_annulled[entry["id"]]
                )
                self.assertIn("preguntas de reserva deben ser contestadas", evidence["sourceUseInstructionText"])
                self.assertIn("todos los puestos de reserva", evidence["rationale"])
                self.assertEqual(evidence["substitutions"], [])
                importer.validate_exam_package(exam, FIXTURES_DIR / exam["source"]["pdf"])

                qa_path = BANK_DIR / f"{entry['id']}.qa.md"
                qa = qa_path.read_text(encoding="utf-8")
                self.assertIn("## Evidencia oficial de uso de reservas", qa)
                self.assertIn("Páginas fuente: [1, 37]", qa)

    def test_public_validator_rejects_domain_and_hash_contradictions(self) -> None:
        exam = load_real_seam2_package()
        mutations = []

        active_annulled = json.loads(canonical_json(exam))
        next(q for q in active_annulled["questions"] if q["status"] == "annulled")["active"] = True
        mutations.append(active_annulled)

        wrong_scorable_set = json.loads(canonical_json(exam))
        wrong_scorable_set["scorableSet"]["count"] -= 1
        mutations.append(wrong_scorable_set)

        blocked_without_reason = json.loads(canonical_json(exam))
        blocked_without_reason["qa"]["state"] = importer.BLOCKED
        blocked_without_reason["qa"]["blockedReason"] = None
        mutations.append(blocked_without_reason)

        invalid_source_hash = json.loads(canonical_json(exam))
        invalid_source_hash["source"]["sha256"] = "no-es-un-sha256"
        mutations.append(invalid_source_hash)

        invalid_content_hash = json.loads(canonical_json(exam))
        invalid_content_hash["version"]["contentSha256"] = "0" * 64
        mutations.append(invalid_content_hash)

        invalid_version_hash = json.loads(canonical_json(exam))
        invalid_version_hash["version"]["id"] = "0" * 64
        mutations.append(invalid_version_hash)

        for package in mutations:
            with self.subTest(package=mutations.index(package)):
                with self.assertRaises(importer.CanonicalPackageError):
                    importer.validate_exam_package(package)

        contradictory_evidence = json.loads(canonical_json(exam))
        contradictory_evidence["scorableSet"]["reserveUseEvidence"][
            "definitiveKeyAnnulledNumbers"
        ] = [13, 14, 70]
        content_hash = importer.canonical_content_sha256(contradictory_evidence)
        contradictory_evidence["version"]["contentSha256"] = content_hash
        contradictory_evidence["version"]["id"] = hashlib.sha256(
            f"{contradictory_evidence['source']['sha256']}:{content_hash}".encode("ascii")
        ).hexdigest()
        with self.assertRaisesRegex(importer.CanonicalPackageError, "evidencia oficial"):
            importer.validate_exam_package(contradictory_evidence)

        ambiguous_reserve_treatment = json.loads(canonical_json(exam))
        unused_reserve = next(
            q for q in reversed(ambiguous_reserve_treatment["questions"])
            if q["status"] == "reserve"
        )
        unused_reserve["active"] = False
        unused_reserve["displayLabel"] = None
        scorable = ambiguous_reserve_treatment["scorableSet"]
        scorable["questionNumbers"].remove(unused_reserve["sourceNumber"])
        scorable["count"] -= 1
        scorable["reserveUsedNumbers"].remove(unused_reserve["sourceNumber"])
        scorable["reserveUsedLabels"].pop("R3")
        scorable["reserveUsedCount"] -= 1
        scorable["reserveUnusedCount"] += 1
        content_hash = importer.canonical_content_sha256(ambiguous_reserve_treatment)
        ambiguous_reserve_treatment["version"]["contentSha256"] = content_hash
        ambiguous_reserve_treatment["version"]["id"] = hashlib.sha256(
            f"{ambiguous_reserve_treatment['source']['sha256']}:{content_hash}".encode("ascii")
        ).hexdigest()
        with self.assertRaisesRegex(importer.CanonicalPackageError, "evidencia de uso total"):
            importer.validate_exam_package(ambiguous_reserve_treatment)

        with tempfile.TemporaryDirectory(prefix="sas-source-hash-") as directory:
            altered_source = Path(directory) / exam["source"]["pdf"]
            altered_source.write_bytes(
                (FIXTURES_DIR / exam["source"]["pdf"]).read_bytes() + b"alterado"
            )
            with self.assertRaisesRegex(importer.CanonicalPackageError, "source.sha256"):
                importer.validate_exam_package(exam, altered_source)

    def test_domain_invariants(self) -> None:
        fixtures = {REAL_SEAM2_EXAM_ID: load_real_seam2_package()}
        for name, exam in fixtures.items():
            by_number = {q["sourceNumber"]: q for q in exam["questions"]}
            self.assertEqual(len(by_number), len(exam["questions"]), f"{name}: números duplicados")
            # identidad de pregunta = examen + número fuente
            for q in exam["questions"]:
                self.assertEqual(q["id"], f"{exam['id']}-q{q['sourceNumber']:03d}", name)
                self.assertEqual([o["id"] for o in q["options"]], ["A", "B", "C", "D"], name)
            # activas: ordinarias no anuladas; con opciones y respuesta oficial
            for q in exam["questions"]:
                if q["status"] == "valid":
                    self.assertTrue(q["active"], f"{name} q{q['sourceNumber']}")
                    self.assertIn(q["correctOption"], "ABCD", name)
                    self.assertIsNone(q["displayLabel"], name)
                elif q["status"] == "annulled":
                    self.assertFalse(q["active"], f"{name} q{q['sourceNumber']}")
                    self.assertIsNone(q["correctOption"], f"{name} q{q['sourceNumber']}")
                    self.assertIsNone(q["displayLabel"], name)
                else:  # reserve
                    self.assertGreaterEqual(q["sourceNumber"], 151, name)
            # conjunto puntuable == activas; anuladas inactivas con salto de numeración
            scorable = set(exam["scorableSet"]["questionNumbers"])
            active = {q["sourceNumber"] for q in exam["questions"] if q["active"]}
            self.assertEqual(scorable, active, name)
            self.assertEqual(exam["scorableSet"]["count"], len(active), name)
            annulled = {q["sourceNumber"] for q in exam["questions"] if q["status"] == "annulled"}
            self.assertEqual(set(exam["scorableSet"]["annulledNumbers"]), annulled, name)
            self.assertFalse(annulled & active, f"{name}: anuladas activas")
            used_reserves = [
                q["sourceNumber"] for q in exam["questions"]
                if q["status"] == "reserve" and q["active"]
            ]
            self.assertEqual(exam["scorableSet"]["reserveUsedNumbers"], used_reserves, name)
            for index, number in enumerate(used_reserves, start=1):
                self.assertEqual(by_number[number]["displayLabel"], f"R{index}", name)
            for number in set(exam["scorableSet"]["reserveNumbers"]) - set(used_reserves):
                self.assertFalse(by_number[number]["active"], name)
                self.assertIsNone(by_number[number]["displayLabel"], name)
            self.assertEqual(exam["scorableSet"]["reserveUnusedCount"],
                             len(exam["scorableSet"]["reserveNumbers"]) - len(used_reserves), name)
            # los números fuente se conservan (sin renumeración): 1..N con saltos solo por anuladas
            numbers = sorted(q["sourceNumber"] for q in exam["questions"])
            self.assertEqual(numbers, sorted(set(numbers)), name)

    def test_version_traces_source_and_covers_final_canonical_content(self) -> None:
        fixtures = {
            REAL_SEAM2_EXAM_ID: load_real_seam2_package(),
            "blocked-2023": self.results["Examen_ADM_L_2023.pdf"].exam,
        }
        for name, exam in fixtures.items():
            content_hash = importer.canonical_content_sha256(exam)
            self.assertEqual(exam["version"]["contentSha256"], content_hash, name)
            expected_version = hashlib.sha256(
                f"{exam['source']['sha256']}:{content_hash}".encode("ascii")
            ).hexdigest()
            self.assertEqual(exam["version"]["id"], expected_version, name)
    def test_2023_q35_anomaly_reported_unchanged(self) -> None:
        result = self.results["Examen_ADM_L_2023.pdf"]
        self.assertEqual(result.state, importer.BLOCKED)
        flags = result.qa["flags"]
        self.assertTrue(
            any(
                f["question"] == 35 and "sancionadoras" in f["flag"]
                for f in flags
            ),
            f"anomalía Q35 no registrada en QA: {flags}",
        )

    def test_real_producer_output_is_the_seam2_consumed_package(self) -> None:
        pdf = FIXTURES_DIR / "Examen_ADM_L_2021.pdf"
        with tempfile.TemporaryDirectory(prefix="sas-seam2-") as directory:
            outdir = Path(directory)
            completed = run_import(pdf, outdir)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            catalog = json.loads((outdir / "catalog.json").read_text(encoding="utf-8"))
            generated_path = outdir / catalog["exams"][0]["latestPath"]
            generated = json.loads(generated_path.read_text(encoding="utf-8"))
        fixture = load_real_seam2_package()
        self.assertEqual(canonical_json(fixture), canonical_json(generated))
        self.assertEqual(fixture["source"]["pdf"], pdf.name)
        self.assertEqual(fixture["qa"]["state"], importer.PUBLICABLE)
        importer.validate_exam_package(fixture, pdf)

    def test_publishing_new_version_preserves_old_addressable_version(self) -> None:
        questions = [(1, "¿Pregunta uno?", four_options())]
        first_pdf = make_synthetic(questions, {1: "A"})
        second_pdf = make_synthetic(questions, {1: "B"})

        with tempfile.TemporaryDirectory(prefix="sas-bank-") as directory:
            outdir = Path(directory)
            first_run = run_import(first_pdf, outdir)
            self.assertEqual(first_run.returncode, 0, first_run.stderr)
            first_catalog = json.loads((outdir / "catalog.json").read_text(encoding="utf-8"))
            first_path = outdir / first_catalog["exams"][0]["latestPath"]
            first_exam = json.loads(first_path.read_text(encoding="utf-8"))
            first_qa_path = first_path.with_suffix(".qa.md")
            first_qa = first_qa_path.read_text(encoding="utf-8")

            second_run = run_import(second_pdf, outdir)
            self.assertEqual(second_run.returncode, 0, second_run.stderr)
            catalog = json.loads((outdir / "catalog.json").read_text(encoding="utf-8"))
            second_path = outdir / catalog["exams"][0]["latestPath"]
            second_exam = json.loads(second_path.read_text(encoding="utf-8"))
            self.assertTrue(first_path.exists())
            self.assertTrue(second_path.exists())
            self.assertNotEqual(first_exam["version"]["id"], second_exam["version"]["id"])
            self.assertEqual(catalog["exams"][0]["latestVersion"], second_exam["version"]["id"])

            first_qa_path.write_text("colisión deliberada\n", encoding="utf-8")
            collision = run_import(first_pdf, outdir)
            self.assertNotEqual(collision.returncode, 0)
            self.assertIn("colisión de QA inmutable", collision.stderr)
            self.assertEqual(first_qa_path.read_text(encoding="utf-8"), "colisión deliberada\n")
            self.assertNotEqual(first_qa, "colisión deliberada\n")

    def test_invalid_catalog_rejects_without_changing_published_output(self) -> None:
        questions = [(1, "¿Pregunta uno?", four_options())]
        first_pdf = make_synthetic(questions, {1: "A"})
        second_pdf = make_synthetic(questions, {1: "B"})

        with tempfile.TemporaryDirectory(prefix="sas-bank-failsafe-") as directory:
            outdir = Path(directory)
            first_run = run_import(first_pdf, outdir)
            self.assertEqual(first_run.returncode, 0, first_run.stderr)
            (outdir / "catalog.json").write_text("{catálogo roto\n", encoding="utf-8")
            before = published_snapshot(outdir)

            rejected = run_import(second_pdf, outdir)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("catálogo no legible", rejected.stderr)
            self.assertEqual(published_snapshot(outdir), before)

    def test_contradictory_catalog_rejects_without_changing_published_output(self) -> None:
        questions = [(1, "¿Pregunta uno?", four_options())]
        first_pdf = make_synthetic(questions, {1: "A"})
        second_pdf = make_synthetic(questions, {1: "B"})

        with tempfile.TemporaryDirectory(prefix="sas-bank-catalog-") as directory:
            outdir = Path(directory)
            first_run = run_import(first_pdf, outdir)
            self.assertEqual(first_run.returncode, 0, first_run.stderr)
            catalog_path = outdir / "catalog.json"
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            catalog["exams"][0]["latestVersion"] = "0" * 64
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            before = published_snapshot(outdir)

            rejected = run_import(second_pdf, outdir)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("ruta de catálogo no válida", rejected.stderr)
            self.assertEqual(published_snapshot(outdir), before)

    def test_late_output_failure_rolls_back_every_published_file(self) -> None:
        questions = [(1, "¿Pregunta uno?", four_options())]
        first_pdf = make_synthetic(questions, {1: "A"})
        second_pdf = make_synthetic(questions, {1: "B"})

        with tempfile.TemporaryDirectory(prefix="sas-bank-rollback-") as directory:
            outdir = Path(directory)
            first_run = run_import(first_pdf, outdir)
            self.assertEqual(first_run.returncode, 0, first_run.stderr)
            before = published_snapshot(outdir)
            second_result = importer.build_exam(second_pdf)
            self.assertEqual(second_result.state, importer.PUBLICABLE)

            real_replace = os.replace
            replace_calls = 0

            def fail_once_after_alias_change(source: Path, target: Path) -> None:
                nonlocal replace_calls
                replace_calls += 1
                if replace_calls == 6:
                    raise OSError("fallo de escritura deliberado")
                real_replace(source, target)

            with mock.patch.object(
                importer.os, "replace", side_effect=fail_once_after_alias_change
            ):
                with self.assertRaisesRegex(OSError, "fallo de escritura deliberado"):
                    importer.write_outputs(second_result, outdir)

            self.assertEqual(published_snapshot(outdir), before)

    def test_persistent_replace_failure_uses_verified_restore_fallback(self) -> None:
        questions = [(1, "¿Pregunta uno?", four_options())]
        first_pdf = make_synthetic(questions, {1: "A"})
        second_pdf = make_synthetic(questions, {1: "B"})

        with tempfile.TemporaryDirectory(prefix="sas-bank-persistent-rollback-") as directory:
            outdir = Path(directory)
            first_run = run_import(first_pdf, outdir)
            self.assertEqual(first_run.returncode, 0, first_run.stderr)
            before = published_snapshot(outdir)
            second_result = importer.build_exam(second_pdf)

            real_replace = os.replace
            replace_calls = 0

            def fail_persistently_after_alias_change(source: Path, target: Path) -> None:
                nonlocal replace_calls
                replace_calls += 1
                if replace_calls >= 6:
                    raise OSError("fallo persistente deliberado")
                real_replace(source, target)

            with mock.patch.object(
                importer.os, "replace", side_effect=fail_persistently_after_alias_change
            ):
                with self.assertRaisesRegex(OSError, "fallo persistente deliberado"):
                    importer.write_outputs(second_result, outdir)

            self.assertEqual(published_snapshot(outdir), before)
            self.assertEqual(list(outdir.rglob("*.bak")), [])

    def test_publication_reports_and_preserves_unrestorable_backups(self) -> None:
        questions = [(1, "¿Pregunta uno?", four_options())]
        first_pdf = make_synthetic(questions, {1: "A"})
        second_pdf = make_synthetic(questions, {1: "B"})

        with tempfile.TemporaryDirectory(prefix="sas-backup-preserved-") as directory:
            outdir = Path(directory)
            first_run = run_import(first_pdf, outdir)
            self.assertEqual(first_run.returncode, 0, first_run.stderr)
            before = published_snapshot(outdir)
            second_result = importer.build_exam(second_pdf)
            real_replace = os.replace
            real_open = Path.open
            replace_calls = 0

            def fail_persistently_after_alias_change(source: Path, target: Path) -> None:
                nonlocal replace_calls
                replace_calls += 1
                if replace_calls >= 6:
                    raise OSError("replace persistente")
                real_replace(source, target)

            def fail_backup_copy(path: Path, *args, **kwargs):
                mode = args[0] if args else kwargs.get("mode", "r")
                if path.suffix == ".bak" and "r" in mode:
                    raise OSError("copia imposible")
                return real_open(path, *args, **kwargs)

            with mock.patch.object(
                importer.os, "replace", side_effect=fail_persistently_after_alias_change
            ), mock.patch.object(Path, "open", fail_backup_copy):
                with self.assertRaisesRegex(RuntimeError, "backup recuperable conservado"):
                    importer.write_outputs(second_result, outdir)

            backups = list(outdir.rglob("*.bak"))
            self.assertTrue(backups)
            self.assertTrue(any(backup.read_bytes() in before.values() for backup in backups))

    def test_bank_command_classifies_all_exact_inputs_and_succeeds(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sas-bank-command-") as directory:
            outdir = Path(directory)
            legacy_target = outdir / "sas-administrativo-2023-turno-libre.json"
            legacy_target.write_bytes(
                (BANK_DIR / "sas-administrativo-2023-turno-libre.json").read_bytes()
            )
            legacy_before = legacy_target.read_bytes()
            completed = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "import_sas_bank.py"),
                 str(FIXTURES_DIR), str(outdir)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn("2/12 publicable", completed.stdout)
            self.assertIn("10/12 bloqueado con causa", completed.stdout)
            self.assertIn("0/12 error/no clasificado", completed.stdout)
            self.assertEqual(legacy_target.read_bytes(), legacy_before)
            reports = list((outdir / "blocked").glob("*.qa.md"))
            self.assertEqual(len(reports), 10)
            blocked_packages = list((outdir / "blocked").glob("*/versions/*.json"))
            self.assertEqual(len(blocked_packages), 10)
            for package_path in blocked_packages:
                package = json.loads(package_path.read_text(encoding="utf-8"))
                self.assertEqual(package["qa"]["state"], importer.BLOCKED)
                importer.validate_exam_package(package)
            catalog = json.loads((outdir / "catalog.json").read_text(encoding="utf-8"))
            self.assertEqual({entry["id"] for entry in catalog["exams"]}, {
                "sas-administrativo-2018-promocion-interna",
                "sas-administrativo-2021-turno-libre",
            })

    def test_bank_command_fails_on_unexpected_processing_error(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sas-bank-input-") as inputs, \
             tempfile.TemporaryDirectory(prefix="sas-bank-output-") as output:
            input_dir = Path(inputs)
            source = FIXTURES_DIR / EXPECTED_FIXTURES[0]
            for name in EXPECTED_FIXTURES:
                (input_dir / name).write_bytes(source.read_bytes())
            (input_dir / EXPECTED_FIXTURES[-1]).write_bytes(b"no es un PDF")
            completed = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "import_sas_bank.py"), inputs, output],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("ERROR inesperado/no clasificado", completed.stderr)
            self.assertIn("1/12 error/no clasificado", completed.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
