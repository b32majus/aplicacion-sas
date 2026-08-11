#!/usr/bin/env python3
"""Prepare and verify human-gated canonical exam publication proposals."""
from __future__ import annotations

import argparse
import ipaddress
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

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
LEGACY_PUBLIC_FILES = {"sas-administrativo-2023-turno-libre.json"}
SENSITIVE_PATH_WORDS = {
    "apikey", "credential", "credentials", "password", "passwd",
    "secret", "signature", "token",
}


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
    hostname = parsed.hostname.lower().rstrip(".") if parsed and parsed.hostname else ""
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
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        labels = hostname.split(".")
        if (
            len(labels) < 2
            or hostname == "localhost"
            or hostname.endswith((".localhost", ".local", ".internal"))
            or any(
                not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                for label in labels
            )
        ):
            raise PublicationBlockedError("officialSource.reference no identifica un host público")
    else:
        if not address.is_global:
            raise PublicationBlockedError("officialSource.reference no identifica una IP pública")
    for segment in unquote(parsed.path).lower().split("/"):
        words = {word for word in re.split(r"[^a-z0-9]+", segment) if word}
        if words & SENSITIVE_PATH_WORDS or "apikey" in segment.replace("-", "").replace("_", ""):
            raise PublicationBlockedError(
                "officialSource.reference contiene credenciales o secretos en la ruta"
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
    allowed_files = {"catalog.json"}
    allowed_files.update(name for name in LEGACY_PUBLIC_FILES if (bank / name).is_file())
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
        allowed_files.update({
            package_path.relative_to(bank).as_posix(),
            qa_path.relative_to(bank).as_posix(),
        })
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
            allowed_files.update({alias.name, alias_qa.name})
            if alias.read_bytes() != package_path.read_bytes() or alias_qa.read_text(encoding="utf-8") != expected_qa:
                raise PublicationBlockedError(f"alias actual no corresponde a la versión catalogada: {package['id']}")

    for package_path in sorted((bank / "blocked").glob("*/versions/*.json")):
        package = load_json(package_path)
        try:
            validate_exam_package(package)
        except CanonicalPackageError as error:
            raise PublicationBlockedError(f"paquete bloqueado inválido {package_path}: {error}") from error
        expected = (
            bank / "blocked" / package["id"] / "versions" /
            f"{package['version']['id']}.json"
        )
        if package_path != expected or package["qa"]["state"] == PUBLICABLE:
            raise PublicationBlockedError(f"ruta/estado bloqueado no reconocido: {package_path}")
        report = bank / "blocked" / f"{Path(package['source']['pdf']).stem}.qa.md"
        try:
            actual_report = report.read_text(encoding="utf-8")
        except OSError as error:
            raise PublicationBlockedError(f"QA bloqueado ausente: {report}") from error
        if actual_report != qa_markdown(package, qa_from_exam(package)):
            raise PublicationBlockedError(f"QA bloqueado no corresponde al paquete: {report}")
        allowed_files.update({
            package_path.relative_to(bank).as_posix(),
            report.relative_to(bank).as_posix(),
        })

    actual_files = set()
    for path in bank.rglob("*"):
        if path.is_symlink():
            raise PublicationBlockedError(f"enlace no permitido en banco público: {path}")
        if path.is_file():
            actual_files.add(path.relative_to(bank).as_posix())
    unexpected = sorted(actual_files - allowed_files)
    missing = sorted(allowed_files - actual_files)
    if unexpected or missing:
        raise PublicationBlockedError(
            f"artefactos públicos no reconocidos: extras={unexpected}, ausentes={missing}"
        )


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


def verify_immutable_changes(base: str, bank: Path, repo: Path = ROOT, head: str = "HEAD") -> None:
    try:
        relative_bank = bank.resolve().relative_to(repo.resolve()).as_posix()
    except ValueError as error:
        raise PublicationBlockedError("el banco debe estar dentro del repositorio verificado") from error
    completed = subprocess.run(
        ["git", "diff", "--name-status", base, head, "--", relative_bank],
        cwd=repo,
        text=True,
        capture_output=True,
        check=True,
    )
    catalog = load_json(bank / "catalog.json")
    current_aliases = {
        f"{relative_bank}/{entry['id']}{suffix}"
        for entry in catalog["exams"]
        for suffix in (".json", ".qa.md")
    }
    current_versions = {
        f"{relative_bank}/{path}"
        for entry in catalog["exams"]
        for path in (entry["latestPath"], str(Path(entry["latestPath"]).with_suffix(".qa.md")))
    }
    catalog_name = f"{relative_bank}/catalog.json"
    violations = []
    for line in completed.stdout.splitlines():
        fields = line.split("\t")
        status, paths = fields[0], fields[1:]
        if len(paths) != 1:
            violations.append(line)
            continue
        changed_path = paths[0]
        allowed = (
            status == "M" and changed_path in {catalog_name, *current_aliases}
        ) or (
            status == "A" and changed_path in {catalog_name, *current_aliases, *current_versions}
        )
        if not allowed:
            violations.append(line)
    if violations:
        raise PublicationBlockedError(
            "el cambio no corresponde a salidas generadas e inmutables: " + " | ".join(violations)
        )


def proposal_identity(exam_id: str, version: str) -> tuple[str, str]:
    return (
        f"automation/exam-{exam_id}-{version[:12]}",
        f"data(exams): publish {exam_id} {version}",
    )


def proposal_already_recorded(records: list[dict], exam_id: str, version: str) -> bool:
    branch, title = proposal_identity(exam_id, version)
    return any(
        record.get("headRefName") == branch or record.get("title") == title
        for record in records
    )


def lookup_proposal(exam_id: str, version: str, repository: str, runner=None) -> bool:
    if (
        not EXAM_ID_RE.fullmatch(exam_id)
        or not SHA256_RE.fullmatch(version)
        or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository)
    ):
        raise PublicationBlockedError("identidad de propuesta o repositorio no válido")
    _, title = proposal_identity(exam_id, version)
    run = runner or subprocess.run
    try:
        completed = run(
            [
                "gh", "pr", "list",
                "--repo", repository,
                "--state", "all",
                "--search", f'"{title}" in:title',
                "--json", "headRefName,title",
            ],
            text=True,
            capture_output=True,
            check=False,
        )
    except OSError as error:
        raise PublicationBlockedError(f"no se pudo ejecutar GitHub CLI: {error}") from error
    if completed.returncode != 0:
        raise PublicationBlockedError(
            f"GitHub no pudo consultar propuestas existentes (exit {completed.returncode})"
        )
    try:
        records = json.loads(completed.stdout)
    except (TypeError, json.JSONDecodeError) as error:
        raise PublicationBlockedError("GitHub devolvió JSON de propuestas no válido") from error
    if not isinstance(records, list) or any(
        not isinstance(record, dict)
        or not isinstance(record.get("title"), str)
        or not isinstance(record.get("headRefName"), (str, type(None)))
        for record in records
    ):
        raise PublicationBlockedError("GitHub devolvió registros de propuestas no válidos")
    return proposal_already_recorded(records, exam_id, version)


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
    proposal_parser = subparsers.add_parser("proposal-status")
    proposal_parser.add_argument("--exam-id", required=True)
    proposal_parser.add_argument("--version", required=True)
    proposal_parser.add_argument("--repository", required=True)
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
        elif args.command == "proposal-status":
            try:
                recorded = lookup_proposal(
                    args.exam_id, args.version, args.repository
                )
            except PublicationBlockedError:
                raise
            except Exception as error:
                raise PublicationBlockedError(
                    f"fallo operativo inesperado al consultar propuestas: {error}"
                ) from error
            print("RECORDED" if recorded else "NOT_FOUND")
            raise SystemExit(0 if recorded else 1)
        else:
            ids = changed_exam_ids(args.inputs, args.before, args.after, args.exam_id)
            write_github_output(args.github_output, {"exam_ids": json.dumps(ids)})
            print(json.dumps(ids))
    except (PublicationBlockedError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"BLOCKED: {error}", file=sys.stderr)
        raise SystemExit(2) from error


if __name__ == "__main__":
    main()
