from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import parse_sas_exam as importer
import publish_exam

BANK = ROOT / "app/public/data/exams"
EXAM_ID = "sas-administrativo-2021-turno-libre"
SOURCE_FIXTURE = ROOT / "tests/fixtures/publication" / f"{EXAM_ID}.source.json"
PUBLICATION_WORKFLOW = ROOT / ".github/workflows/exam-publication.yml"
CHECK_WORKFLOW = ROOT / ".github/workflows/exam-publication-check.yml"
CI_WORKFLOW = ROOT / ".github/workflows/ci.yml"


def load_current() -> dict:
    catalog = json.loads((BANK / "catalog.json").read_text(encoding="utf-8"))
    entry = next(item for item in catalog["exams"] if item["id"] == EXAM_ID)
    return json.loads((BANK / entry["latestPath"]).read_text(encoding="utf-8"))


def graphql_pages(*pages: tuple[list[dict], bool, str | None]) -> str:
    return json.dumps([
        {
            "data": {
                "repository": {
                    "pullRequests": {
                        "nodes": nodes,
                        "pageInfo": {"hasNextPage": has_next, "endCursor": cursor},
                    }
                }
            }
        }
        for nodes, has_next, cursor in pages
    ])


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
        self.registry = self.root / "registry"
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

    def git(self, repo: Path, *args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=repo, text=True, capture_output=True, check=True
        ).stdout.strip()

    def committed_bank(self, name: str) -> tuple[Path, Path, str]:
        repo = self.root / name
        bank = repo / "app/public/data/exams"
        bank.parent.mkdir(parents=True)
        shutil.copytree(BANK, bank)
        self.git(repo, "init", "-b", "main")
        self.git(repo, "config", "user.name", "T12 Test")
        self.git(repo, "config", "user.email", "t12@example.invalid")
        self.git(repo, "add", ".")
        self.git(repo, "commit", "-m", "baseline")
        return repo, bank, self.git(repo, "rev-parse", "HEAD")

    def commit_candidate(self, repo: Path) -> None:
        self.git(repo, "add", "-A")
        self.git(repo, "commit", "-m", "candidate")

    def prepared_registry(self, name: str) -> tuple[Path, Path, Path, dict]:
        root = self.root / name
        bank = root / "bank"
        registry = root / "registry"
        shutil.copytree(BANK, bank)
        exam = load_current()
        exam["title"] += f" - {name}"
        reversion(exam)
        exam_path = root / f"{EXAM_ID}.json"
        metadata_path = root / f"{EXAM_ID}.source.json"
        exam_path.write_text(json.dumps(exam, ensure_ascii=False), encoding="utf-8")
        metadata_path.write_bytes(SOURCE_FIXTURE.read_bytes())
        publish_exam.prepare(exam_path, metadata_path, bank, root / "summary.md", registry)
        registration = registry / EXAM_ID / f"{exam['version']['id']}.sql"
        return bank, registry, registration, exam

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
            self.exam_path, self.metadata_path, self.bank, self.summary, self.registry
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
            publish_exam.prepare(self.exam_path, self.metadata_path, self.bank, self.summary, self.registry)
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
            publish_exam.prepare(self.exam_path, self.metadata_path, self.bank, self.summary, self.registry)
        self.assertEqual(self.snapshot(self.bank), before)

    def test_source_hash_mismatch_and_secret_bearing_url_are_rejected(self) -> None:
        exam = load_current()
        self.write_exam(exam)
        metadata = json.loads(SOURCE_FIXTURE.read_text(encoding="utf-8"))
        metadata["officialSource"]["sha256"] = "0" * 64
        self.metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
        with self.assertRaisesRegex(publish_exam.PublicationBlockedError, "no coincide"):
            publish_exam.prepare(self.exam_path, self.metadata_path, self.bank, self.summary, self.registry)

        metadata["officialSource"]["sha256"] = exam["source"]["sha256"]
        metadata["officialSource"]["reference"] = "https://official.example/exam?token=secret"
        self.metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
        with self.assertRaisesRegex(publish_exam.PublicationBlockedError, "query"):
            publish_exam.prepare(self.exam_path, self.metadata_path, self.bank, self.summary, self.registry)

    def test_source_reference_rejects_non_public_hosts_and_path_secrets(self) -> None:
        exam = load_current()
        metadata = json.loads(SOURCE_FIXTURE.read_text(encoding="utf-8"))
        rejected = [
            "https://localhost/examenes/2026",
            "https://intranet/examenes/2026",
            "https://exam.sas.internal/examenes/2026",
            "https://exam.sas.local/examenes/2026",
            "https://127.0.0.1/examenes/2026",
            "https://10.2.3.4/examenes/2026",
            "https://169.254.1.1/examenes/2026",
            "https://192.0.2.1/examenes/2026",
            "https://www.sspa.juntadeandalucia.es/token/abc",
            "https://www.sspa.juntadeandalucia.es/examen/api-key-value",
            "https://www.sspa.juntadeandalucia.es/signature/abc",
        ]
        for reference in rejected:
            with self.subTest(reference=reference):
                metadata["officialSource"]["reference"] = reference
                with self.assertRaises(publish_exam.PublicationBlockedError):
                    publish_exam.validate_source_metadata(metadata, exam, SOURCE_FIXTURE)

        metadata["officialSource"]["reference"] = (
            "https://www.sspa.juntadeandalucia.es/servicioandaluzdesalud/"
            "profesionales/ofertas-de-empleo/examenes-2026"
        )
        publish_exam.validate_source_metadata(metadata, exam, SOURCE_FIXTURE)

    def test_unchanged_input_is_idempotent_and_does_not_duplicate_version(self) -> None:
        exam = load_current()
        self.write_exam(exam)
        before = self.snapshot(self.bank)
        publish_exam.prepare(self.exam_path, self.metadata_path, self.bank, self.summary, self.registry)
        self.assertEqual(self.snapshot(self.bank), before)
        versions = list((self.bank / EXAM_ID / "versions").glob(f"{exam['version']['id']}.json"))
        self.assertEqual(len(versions), 1)

    def test_verify_bank_rejects_tampered_qa(self) -> None:
        qa_path = next(self.bank.glob("*/versions/*.qa.md"))
        qa_path.write_text("QA alterado\n", encoding="utf-8")
        with self.assertRaisesRegex(publish_exam.PublicationBlockedError, "QA versionado"):
            publish_exam.verify_bank(self.bank)

    def test_verify_bank_accepts_legacy_blocked_corpus_but_rejects_extra_artifacts(self) -> None:
        publish_exam.verify_bank(self.bank)
        extras = {
            "orphan.json": "{}\n",
            "service-role-token.txt": "not-a-real-secret\n",
            "orphan/versions/" + "0" * 64 + ".json": "{}\n",
            "blocked/unrecognized.qa.md": "orphan\n",
        }
        for index, (relative, content) in enumerate(extras.items()):
            with self.subTest(relative=relative):
                candidate = self.root / f"extra-{index}"
                shutil.copytree(BANK, candidate)
                target = candidate / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
                with self.assertRaisesRegex(
                    publish_exam.PublicationBlockedError,
                    "no reconocidos|paquete inválido",
                ):
                    publish_exam.verify_bank(candidate)

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

    def test_real_git_comparison_accepts_only_generated_correction_outputs(self) -> None:
        repo, bank, base = self.committed_bank("git-allowed")
        corrected = load_current()
        corrected["title"] += " - corrección git"
        reversion(corrected)
        exam_path = repo / f"{EXAM_ID}.json"
        source_path = repo / f"{EXAM_ID}.source.json"
        exam_path.write_text(json.dumps(corrected, ensure_ascii=False), encoding="utf-8")
        source_path.write_bytes(SOURCE_FIXTURE.read_bytes())
        publish_exam.prepare(
            exam_path,
            source_path,
            bank,
            repo / "summary.md",
            repo / "supabase/official-exam-registrations",
        )
        exam_path.unlink()
        source_path.unlink()
        (repo / "summary.md").unlink()
        self.commit_candidate(repo)

        publish_exam.verify_bank(bank)
        publish_exam.verify_immutable_changes(base, bank, repo=repo)

    def test_real_git_comparison_rejects_non_generated_changes(self) -> None:
        mutations = {
            "modified-blocked-report": lambda bank: next((bank / "blocked").glob("*.qa.md")).write_text(
                "alterado\n", encoding="utf-8"
            ),
            "deleted-legacy-alias": lambda bank: (bank / "sas-administrativo-2023-turno-libre.json").unlink(),
            "modified-old-version": lambda bank: next(bank.glob("*/versions/*.json")).write_text(
                "{}\n", encoding="utf-8"
            ),
            "secret-extra": lambda bank: (bank / "service-role-token.txt").write_text(
                "not-a-real-secret\n", encoding="utf-8"
            ),
        }
        for index, (name, mutate) in enumerate(mutations.items()):
            with self.subTest(name=name):
                repo, bank, base = self.committed_bank(f"git-rejected-{index}")
                mutate(bank)
                self.commit_candidate(repo)
                with self.assertRaisesRegex(
                    publish_exam.PublicationBlockedError, "no corresponde a salidas generadas"
                ):
                    publish_exam.verify_immutable_changes(base, bank, repo=repo)

    def test_proposal_identity_blocks_closed_or_merged_duplicates(self) -> None:
        exam = load_current()
        branch, title = publish_exam.proposal_identity(EXAM_ID, exam["version"]["id"])
        for record in (
            {"headRefName": branch, "title": "renamed after close", "state": "CLOSED"},
            {"headRefName": "deleted-branch", "title": title, "state": "MERGED"},
        ):
            with self.subTest(record=record):
                self.assertTrue(
                    publish_exam.proposal_already_recorded([record], EXAM_ID, exam["version"]["id"])
                )
        self.assertFalse(
            publish_exam.proposal_already_recorded(
                [{"headRefName": "other", "title": "other"}], EXAM_ID, exam["version"]["id"]
            )
        )

    def test_proposal_lookup_paginates_all_states_and_finds_later_closed_match(self) -> None:
        exam = load_current()
        version = exam["version"]["id"]
        _, title = publish_exam.proposal_identity(EXAM_ID, version)
        calls = []

        def recorded_runner(arguments, **kwargs):
            calls.append((arguments, kwargs))
            return subprocess.CompletedProcess(
                arguments,
                0,
                stdout=graphql_pages(
                    ([{"headRefName": "other", "title": "other", "state": "OPEN"}], True, "cursor-1"),
                    ([{"headRefName": None, "title": title, "state": "CLOSED"}], False, "cursor-2"),
                ),
                stderr="",
            )

        self.assertTrue(
            publish_exam.lookup_proposal(EXAM_ID, version, "owner/repository", recorded_runner)
        )
        arguments, kwargs = calls[0]
        self.assertEqual(arguments[:3], ["gh", "api", "graphql"])
        self.assertIn("--paginate", arguments)
        self.assertIn("--slurp", arguments)
        self.assertIn("owner=owner", arguments)
        self.assertIn("name=repository", arguments)
        query = next(value.removeprefix("query=") for value in arguments if value.startswith("query="))
        self.assertIn("$endCursor: String", query)
        self.assertIn("after: $endCursor", query)
        self.assertIn("pageInfo { hasNextPage endCursor }", query)
        self.assertIn("states: [OPEN, CLOSED, MERGED]", query)
        self.assertNotIn("gh pr list", " ".join(arguments))
        self.assertFalse(kwargs["check"])

        def missing_runner(arguments, **kwargs):
            return subprocess.CompletedProcess(
                arguments, 0, stdout=graphql_pages(([], False, None)), stderr=""
            )

        self.assertFalse(
            publish_exam.lookup_proposal(EXAM_ID, version, "owner/repository", missing_runner)
        )

    def test_proposal_lookup_fails_closed_on_api_json_and_helper_errors(self) -> None:
        version = load_current()["version"]["id"]

        def api_failure(arguments, **kwargs):
            return subprocess.CompletedProcess(arguments, 9, stdout="", stderr="API unavailable")

        def invalid_json(arguments, **kwargs):
            return subprocess.CompletedProcess(arguments, 0, stdout="not-json", stderr="")

        def invalid_records(arguments, **kwargs):
            return subprocess.CompletedProcess(
                arguments,
                0,
                stdout=graphql_pages(([{"title": 7}], False, None)),
                stderr="",
            )

        def graphql_errors(arguments, **kwargs):
            return subprocess.CompletedProcess(
                arguments, 0, stdout='[{"errors":[{"message":"denied"}]}]', stderr=""
            )

        def incomplete_pages(arguments, **kwargs):
            return subprocess.CompletedProcess(
                arguments, 0, stdout=graphql_pages(([], True, "more")), stderr=""
            )

        def missing_cli(arguments, **kwargs):
            raise FileNotFoundError("gh missing")

        for runner in (
            api_failure, invalid_json, invalid_records, graphql_errors,
            incomplete_pages, missing_cli,
        ):
            with self.subTest(runner=runner.__name__):
                with self.assertRaises(publish_exam.PublicationBlockedError):
                    publish_exam.lookup_proposal(EXAM_ID, version, "owner/repository", runner)

    def test_proposal_status_cli_distinguishes_recorded_missing_and_errors(self) -> None:
        version = load_current()["version"]["id"]
        _, title = publish_exam.proposal_identity(EXAM_ID, version)
        fake_bin = self.root / "fake-bin"
        fake_bin.mkdir()
        fake_gh = fake_bin / "gh"
        recorded = graphql_pages(([
            {"headRefName": None, "title": title, "state": "MERGED"}
        ], False, None))
        missing = graphql_pages(([], False, None))
        fake_gh.write_text(
            "#!/bin/sh\n"
            "case \"$FAKE_GH_MODE\" in\n"
            f"  recorded) printf '%s\\n' '{recorded}' ;;\n"
            f"  missing) printf '%s\\n' '{missing}' ;;\n"
            "  invalid) printf '%s\\n' 'not-json' ;;\n"
            "  api) exit 9 ;;\n"
            "esac\n",
            encoding="utf-8",
        )
        fake_gh.chmod(0o755)
        command = [
            sys.executable,
            str(ROOT / "scripts/publish_exam.py"),
            "proposal-status",
            "--exam-id", EXAM_ID,
            "--version", version,
            "--repository", "owner/repository",
        ]
        expected = {"recorded": 0, "missing": 1, "invalid": 2, "api": 2}
        for mode, returncode in expected.items():
            with self.subTest(mode=mode):
                env = os.environ.copy()
                env["PATH"] = f"{fake_bin}:{env['PATH']}"
                env["FAKE_GH_MODE"] = mode
                completed = subprocess.run(
                    command, cwd=ROOT, env=env, text=True, capture_output=True, check=False
                )
                self.assertEqual(completed.returncode, returncode, completed.stderr)

    def test_workflow_contract_uses_reviewed_main_and_least_permissions(self) -> None:
        workflow = PUBLICATION_WORKFLOW.read_text(encoding="utf-8")
        discover, propose = workflow.split("  propose:", maxsplit=1)
        self.assertEqual(workflow.count("uses: actions/checkout@v6"), 2)
        self.assertEqual(workflow.count("ref: main"), 2)
        self.assertEqual(workflow.count("cache-dependency-path: requirements-parser.txt"), 2)
        self.assertIn("uses: actions/setup-python@v6", discover)
        self.assertIn("pip install -r requirements-parser.txt", discover)
        self.assertLess(discover.index("pip install"), discover.index("publish_exam.py changed"))
        self.assertIn("permissions:\n  contents: read", workflow)
        self.assertIn("contents: write\n      pull-requests: write", propose)
        self.assertIn("proposal-status", propose)
        self.assertIn("proposal_status=$?", propose)
        self.assertIn('case "$proposal_status" in', propose)
        self.assertIn("1)\n              echo \"No prior proposal decision exists", propose)
        self.assertIn('exit "$proposal_status"', propose)
        self.assertNotIn("--limit", propose)
        self.assertNotIn("|\n            python scripts/publish_exam.py proposal", propose)
        self.assertIn("group: exam-publication-main", workflow)
        self.assertIn("supabase/official-exam-registrations", workflow)
        for forbidden in ("pages: write", "id-token: write", "deploy-pages", "configure-pages"):
            self.assertNotIn(forbidden, workflow)

        check = CHECK_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("permissions:\n  contents: read", check)
        self.assertIn("cache-dependency-path: requirements-parser.txt", check)
        self.assertIn('"supabase/official-exam-registrations/**"', check)
        self.assertIn("publish_exam.py verify-registry --base", check)
        for forbidden in ("contents: write", "pull-requests: write", "pages: write", "deploy-pages"):
            self.assertNotIn(forbidden, check)

    def test_general_ci_is_read_only_and_credential_free(self) -> None:
        workflow = CI_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("pull_request:", workflow)
        self.assertIn("permissions:\n  contents: read", workflow)
        self.assertIn("uses: actions/setup-python@v6", workflow)
        self.assertIn('python-version: "3.12"', workflow)
        self.assertIn("cache-dependency-path: requirements-parser.txt", workflow)
        self.assertIn("run: python -m venv .venv", workflow)
        self.assertIn("run: .venv/bin/pip install -r requirements-parser.txt", workflow)
        for command in ("npm ci", "npm test", "npm run build"):
            self.assertIn(f"run: {command}", workflow)
        self.assertLess(workflow.index("python -m venv"), workflow.index("run: npm test"))
        self.assertLess(workflow.index("pip install"), workflow.index("run: npm test"))
        for forbidden in (
            "contents: write", "pull-requests: write", "pages: write",
            "id-token: write", "service_role", "SUPABASE_DB", "playwright test",
        ):
            self.assertNotIn(forbidden, workflow)

    def test_third_exam_prepares_static_and_registry_artifacts_idempotently(self) -> None:
        third_id = "sas-administrativo-2026-turno-libre"
        exam = load_current()
        exam["id"] = third_id
        exam["title"] = "SAS Administrativo/a 2026 - Turno Libre"
        exam["year"] = 2026
        exam["source"]["pdf"] = "Examen_ADM_L_2026_manual.json"
        for question in exam["questions"]:
            question["id"] = question["id"].replace(EXAM_ID, third_id)
        reversion(exam)
        exam_path = self.root / f"{third_id}.json"
        source_path = self.root / f"{third_id}.source.json"
        exam_path.write_text(json.dumps(exam, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        metadata = json.loads(SOURCE_FIXTURE.read_text(encoding="utf-8"))
        metadata["examId"] = third_id
        source_path.write_text(json.dumps(metadata), encoding="utf-8")

        values = publish_exam.prepare(
            exam_path, source_path, self.bank, self.summary, self.registry
        )
        version_path = self.bank / third_id / "versions" / f"{exam['version']['id']}.json"
        registration = self.registry / third_id / f"{exam['version']['id']}.sql"
        self.assertTrue(version_path.is_file())
        self.assertTrue(registration.is_file())
        catalog = json.loads((self.bank / "catalog.json").read_text(encoding="utf-8"))
        entry = next(item for item in catalog["exams"] if item["id"] == third_id)
        self.assertEqual(entry["latestPath"], version_path.relative_to(self.bank).as_posix())
        sql = registration.read_text(encoding="utf-8")
        self.assertIn(third_id, sql)
        self.assertIn(exam["version"]["id"], sql)
        self.assertIn("answer_key", sql)
        self.assertEqual(values["registration"], registration.as_posix())

        before = self.snapshot(self.root)
        publish_exam.prepare(exam_path, source_path, self.bank, self.summary, self.registry)
        self.assertEqual(self.snapshot(self.root), before)

    def test_registry_verification_accepts_exact_generation_and_rerun(self) -> None:
        bank, registry, _, exam = self.prepared_registry("registry-exact")
        publish_exam.verify_registry(bank, registry)
        before = self.snapshot(registry)
        publish_exam.write_registration(exam, registry)
        publish_exam.verify_registry(bank, registry)
        self.assertEqual(self.snapshot(registry), before)

    def test_registry_verification_rejects_every_tamper_class(self) -> None:
        mutations = {
            "answer-key": lambda content, exam: content.replace(
                f'"{next(question["id"] for question in exam["questions"] if question["active"])}":',
                '"tampered-question":',
                1,
            ),
            "duration": lambda content, exam: content.replace(
                f", {exam['durationMinutes']},\n    array[",
                f", {exam['durationMinutes'] + 1},\n    array[",
                1,
            ),
            "question-ids": lambda content, exam: content.replace(
                publish_exam.sql_literal(next(question["id"] for question in exam["questions"] if question["active"])),
                publish_exam.sql_literal("unexpected-question"),
                1,
            ),
            "version-path": lambda content, exam: content.replace(
                exam["version"]["id"], "0" * 64, 1
            ),
            "appended-sql": lambda content, exam: content + "select current_user;\n",
        }
        for index, (name, mutate) in enumerate(mutations.items()):
            with self.subTest(name=name):
                bank, registry, registration, exam = self.prepared_registry(f"registry-tamper-{index}")
                content = registration.read_text(encoding="utf-8")
                changed = mutate(content, exam)
                self.assertNotEqual(changed, content)
                registration.write_text(changed, encoding="utf-8")
                with self.assertRaisesRegex(publish_exam.PublicationBlockedError, "alterado"):
                    publish_exam.verify_registry(bank, registry)

    def test_registry_verification_rejects_missing_orphan_and_symlink(self) -> None:
        bank, registry, registration, _ = self.prepared_registry("registry-shape")
        exact = registration.read_bytes()
        registration.unlink()
        with self.assertRaisesRegex(publish_exam.PublicationBlockedError, "faltan registros"):
            publish_exam.verify_registry(bank, registry)

        registration.write_bytes(exact)
        orphan = registry / "orphan-exam" / "orphan-version.sql"
        orphan.parent.mkdir()
        orphan.write_text("select 1;\n", encoding="utf-8")
        with self.assertRaisesRegex(publish_exam.PublicationBlockedError, "huérfanos|inesperados"):
            publish_exam.verify_registry(bank, registry)
        orphan.unlink()
        orphan.parent.rmdir()

        link = registry / "linked.sql"
        link.symlink_to(registration)
        with self.assertRaisesRegex(publish_exam.PublicationBlockedError, "enlaces simbólicos"):
            publish_exam.verify_registry(bank, registry)

    def test_registry_files_present_at_base_are_immutable(self) -> None:
        repo = self.root / "registry-history"
        bank = repo / "app/public/data/exams"
        registry = repo / "supabase/official-exam-registrations"
        bank.parent.mkdir(parents=True)
        shutil.copytree(BANK, bank)
        exam = load_current()
        exam["title"] += " - registry history"
        reversion(exam)
        exam_path = repo / f"{EXAM_ID}.json"
        metadata_path = repo / f"{EXAM_ID}.source.json"
        exam_path.write_text(json.dumps(exam, ensure_ascii=False), encoding="utf-8")
        metadata_path.write_bytes(SOURCE_FIXTURE.read_bytes())
        publish_exam.prepare(exam_path, metadata_path, bank, repo / "summary.md", registry)
        exam_path.unlink()
        metadata_path.unlink()
        (repo / "summary.md").unlink()
        self.git(repo, "init", "-b", "main")
        self.git(repo, "config", "user.name", "T12 Test")
        self.git(repo, "config", "user.email", "t12@example.invalid")
        self.git(repo, "add", ".")
        self.git(repo, "commit", "-m", "registry baseline")
        base = self.git(repo, "rev-parse", "HEAD")
        registration = registry / EXAM_ID / f"{exam['version']['id']}.sql"
        exact = registration.read_bytes()

        registration.write_bytes(exact + b"select 1;\n")
        with self.assertRaises(publish_exam.PublicationBlockedError):
            publish_exam.verify_registry(bank, registry, base=base, repo=repo)
        registration.write_bytes(exact)

        deleted = registration.with_suffix(".deleted.sql")
        registration.rename(deleted)
        with self.assertRaises(publish_exam.PublicationBlockedError):
            publish_exam.verify_registry(bank, registry, base=base, repo=repo)
        deleted.rename(registration)
        publish_exam.verify_registry(bank, registry, base=base, repo=repo)


if __name__ == "__main__":
    unittest.main(verbosity=2)
