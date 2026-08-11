#!/usr/bin/env python3
"""Prepare and verify human-gated canonical exam publication proposals."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

from parse_sas_exam import (
    PUBLICABLE,
    CanonicalPackageError,
    ImportResult,
    _validate_catalog,
    qa_from_exam,
    qa_markdown,
    validate_exam_package,
    write_outputs,
)

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUTS = ROOT / "exam-inputs"
DEFAULT_BANK = ROOT / "app/public/data/exams"
EXAM_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


class PublicationBlockedError(ValueError):
    """Input cannot become a publication proposal."""


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise PublicationBlockedError(f"no se pudo leer JSON {path}: {error}") from error
    if not isinstance(value, dict):
        raise PublicationBlockedError(f"se esperaba un objeto JSON en {path}")
    return value


def validate_source_metadata(metadata: dict, exam: dict, path: Path) -> str:
    expected_keys = {"schemaVersion", "examId", "officialSource"}
    if set(metadata) != expected_keys or metadata.get("schemaVersion") != "1.0":
        raise PublicationBlockedError(f"metadata de fuente no compatible: {path}")
    source = metadata.get("officialSource")
    if not isinstance(source, dict) or set(source) != {"reference", "sha256"}:
        raise PublicationBlockedError(f"officialSource no compatible: {path}")
    if metadata.get("examId") != exam.get("id"):
        raise PublicationBlockedError("examId de metadata no coincide con el paquete canónico")
    if source.get("sha256") != exam.get("source", {}).get("sha256"):
        raise PublicationBlockedError("SHA-256 de metadata no coincide con source.sha256")
    if not SHA256_RE.fullmatch(str(source.get("sha256", ""))):
        raise PublicationBlockedError("SHA-256 oficial no válido")
    reference = source.get("reference")
    parsed = urlsplit(reference) if isinstance(reference, str) else None
    if (
        parsed is None
        or parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise PublicationBlockedError(
            "officialSource.reference debe ser HTTPS y no contener credenciales, query ni fragmento"
        )
    return reference


def reviewer_summary(exam: dict, reference: str) -> str:
    scorable = exam["scorableSet"]
    unused = sorted(set(scorable["reserveNumbers"]) - set(scorable["reserveUsedNumbers"]))
    flags = exam["qa"]["flags"]
    lines = [
        f"# Propuesta de publicación: {exam['title']}",
        "",
        "La validación automática ha preparado artefactos; **solo el merge humano publica**.",
        "",
        "| Revisión | Valor |",
        "|---|---|",
        f"| Identidad | `{exam['id']}` |",
        f"| Fuente oficial | {reference} |",
        f"| SHA-256 de fuente | `{exam['source']['sha256']}` |",
        f"| Versión inmutable | `{exam['version']['id']}` |",
        f"| Duración | {exam['durationMinutes']} min |",
        f"| Activas | {scorable['count']} |",
        f"| Anuladas | {scorable['annulledCount']}: `{scorable['annulledNumbers']}` |",
        f"| Reservas utilizadas | {scorable['reserveUsedCount']}: `{scorable['reserveUsedNumbers']}` |",
        f"| Reservas no utilizadas | {scorable['reserveUnusedCount']}: `{unused}` |",
        f"| Incidencias QA | {len(flags)} |",
        "",
        "## Incidencias QA",
        "",
    ]
    if flags:
        for flag in flags:
            lines.append(
                f"- Pregunta `{flag.get('question') or 'examen'}`, "
                f"página `{flag.get('sourcePage') or '-'}`: `{flag['flag']}`"
            )
    else:
        lines.append("No se detectaron incidencias de texto.")
    lines += [
        "",
        "## Gate humano",
        "",
        "- [ ] Revisar paquete canónico y QA versionado.",
        "- [ ] Confirmar trazabilidad, recuentos, duración e incidencias.",
        "- [ ] Aprobar mediante merge; cerrar sin merge para rechazar.",
    ]
    return "\n".join(lines) + "\n"


def prepare(exam_path: Path, metadata_path: Path, bank: Path, summary_path: Path) -> dict:
    exam = load_json(exam_path)
    try:
        validate_exam_package(exam)
    except CanonicalPackageError as error:
        raise PublicationBlockedError(str(error)) from error
    if exam["qa"]["state"] != PUBLICABLE:
        raise PublicationBlockedError(
            f"{exam['qa']['state']}: {exam['qa'].get('blockedReason') or 'sin diagnóstico'}"
        )
    reference = validate_source_metadata(load_json(metadata_path), exam, metadata_path)
    qa = qa_from_exam(exam)
    result = ImportResult(exam=exam, qa=qa, state=PUBLICABLE, blocked_reason=None)
    write_outputs(result, bank)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(reviewer_summary(exam, reference), encoding="utf-8")
    return {"exam_id": exam["id"], "version": exam["version"]["id"]}


def verify_bank(bank: Path) -> None:
    catalog_path = bank / "catalog.json"
    catalog = load_json(catalog_path)
    _validate_catalog(catalog, catalog_path, bank)
    current_paths = {entry["latestPath"] for entry in catalog["exams"]}
    for package_path in sorted(bank.glob("*/versions/*.json")):
        package = load_json(package_path)
        try:
            validate_exam_package(package)
        except CanonicalPackageError as error:
            raise PublicationBlockedError(f"paquete inválido {package_path}: {error}") from error
        expected = bank / package["id"] / "versions" / f"{package['version']['id']}.json"
        if package_path != expected:
            raise PublicationBlockedError(f"ruta de versión no corresponde a su identidad: {package_path}")
        qa_path = package_path.with_suffix(".qa.md")
        expected_qa = qa_markdown(package, qa_from_exam(package))
        try:
            actual_qa = qa_path.read_text(encoding="utf-8")
        except OSError as error:
            raise PublicationBlockedError(f"QA versionado ausente: {qa_path}") from error
        if actual_qa != expected_qa:
            raise PublicationBlockedError(f"QA versionado no corresponde al paquete: {qa_path}")
        relative = package_path.relative_to(bank).as_posix()
        if relative in current_paths:
            alias = bank / f"{package['id']}.json"
            alias_qa = bank / f"{package['id']}.qa.md"
            if alias.read_bytes() != package_path.read_bytes() or alias_qa.read_text(encoding="utf-8") != expected_qa:
                raise PublicationBlockedError(f"alias actual no corresponde a la versión catalogada: {package['id']}")


def verify_inputs(inputs: Path) -> None:
    canonical_paths = sorted(
        path for path in inputs.glob("*.json") if not path.name.endswith(".source.json")
    )
    sidecar_ids = {
        path.name.removesuffix(".source.json") for path in inputs.glob("*.source.json")
    }
    canonical_ids = {path.name.removesuffix(".json") for path in canonical_paths}
    if sidecar_ids != canonical_ids:
        raise PublicationBlockedError(
            f"pares de entrada incompletos: canonical={sorted(canonical_ids)}, source={sorted(sidecar_ids)}"
        )
    for exam_path in canonical_paths:
        exam_id = exam_path.name.removesuffix(".json")
        exam = load_json(exam_path)
        try:
            validate_exam_package(exam)
        except CanonicalPackageError as error:
            raise PublicationBlockedError(f"paquete de entrada inválido {exam_path}: {error}") from error
        if exam.get("id") != exam_id:
            raise PublicationBlockedError(f"nombre de entrada no coincide con exam.id: {exam_path}")
        if exam["qa"]["state"] != PUBLICABLE:
            raise PublicationBlockedError(
                f"entrada {exam_id} {exam['qa']['state']}: "
                f"{exam['qa'].get('blockedReason') or 'sin diagnóstico'}"
            )
        source_path = inputs / f"{exam_id}.source.json"
        validate_source_metadata(load_json(source_path), exam, source_path)


def verify_immutable_changes(base: str, bank: Path) -> None:
    completed = subprocess.run(
        ["git", "diff", "--name-status", base, "HEAD", "--", bank.as_posix()],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    violations = []
    for line in completed.stdout.splitlines():
        fields = line.split("\t")
        status, paths = fields[0], fields[1:]
        version_paths = [path for path in paths if "/versions/" in path]
        if version_paths and status != "A":
            violations.append(line)
    if violations:
        raise PublicationBlockedError(
            "las versiones existentes son inmutables; cambios prohibidos: " + " | ".join(violations)
        )


def changed_exam_ids(inputs: Path, before: str | None, after: str | None, exam_id: str | None) -> list[str]:
    if exam_id:
        if not EXAM_ID_RE.fullmatch(exam_id):
            raise PublicationBlockedError("exam_id manual no válido")
        candidates = {exam_id}
    elif before and after and before != "0" * 40:
        completed = subprocess.run(
            ["git", "diff", "--name-only", before, after, "--", inputs.as_posix()],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=True,
        )
        candidates = set()
        for name in completed.stdout.splitlines():
            stem = Path(name).name.removesuffix(".json").removesuffix(".source")
            if EXAM_ID_RE.fullmatch(stem):
                candidates.add(stem)
    else:
        candidates = {
            path.name.removesuffix(".json")
            for path in inputs.glob("*.json")
            if not path.name.endswith(".source.json")
        }
    return sorted(
        item
        for item in candidates
        if (inputs / f"{item}.json").is_file() and (inputs / f"{item}.source.json").is_file()
    )


def write_github_output(path: Path | None, values: dict[str, str]) -> None:
    if path is None:
        return
    with path.open("a", encoding="utf-8") as stream:
        for key, value in values.items():
            stream.write(f"{key}={value}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--exam", type=Path, required=True)
    prepare_parser.add_argument("--metadata", type=Path, required=True)
    prepare_parser.add_argument("--bank", type=Path, default=DEFAULT_BANK)
    prepare_parser.add_argument("--summary", type=Path, required=True)
    prepare_parser.add_argument("--github-output", type=Path)
    verify_parser = subparsers.add_parser("verify-bank")
    verify_parser.add_argument("--bank", type=Path, default=DEFAULT_BANK)
    inputs_parser = subparsers.add_parser("verify-inputs")
    inputs_parser.add_argument("--inputs", type=Path, default=DEFAULT_INPUTS)
    immutable_parser = subparsers.add_parser("verify-immutable")
    immutable_parser.add_argument("--base", required=True)
    immutable_parser.add_argument("--bank", type=Path, default=DEFAULT_BANK)
    changed_parser = subparsers.add_parser("changed")
    changed_parser.add_argument("--inputs", type=Path, default=DEFAULT_INPUTS)
    changed_parser.add_argument("--before")
    changed_parser.add_argument("--after")
    changed_parser.add_argument("--exam-id")
    changed_parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()

    try:
        if args.command == "prepare":
            values = prepare(args.exam, args.metadata, args.bank, args.summary)
            write_github_output(args.github_output, values)
            print(f"READY: {values['exam_id']} {values['version']}")
        elif args.command == "verify-bank":
            verify_bank(args.bank)
            print("VALID: banco canónico, catálogo, aliases y QA")
        elif args.command == "verify-inputs":
            verify_inputs(args.inputs)
            print("VALID: entradas canónicas y trazabilidad oficial")
        elif args.command == "verify-immutable":
            verify_immutable_changes(args.base, args.bank)
            print("VALID: ninguna versión existente fue modificada o eliminada")
        else:
            ids = changed_exam_ids(args.inputs, args.before, args.after, args.exam_id)
            write_github_output(args.github_output, {"exam_ids": json.dumps(ids)})
            print(json.dumps(ids))
    except (PublicationBlockedError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"BLOCKED: {error}", file=sys.stderr)
        raise SystemExit(2) from error


if __name__ == "__main__":
    main()
