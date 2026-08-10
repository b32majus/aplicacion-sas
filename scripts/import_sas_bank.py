#!/usr/bin/env python3
"""Importa los 12 PDF oficiales iniciales y clasifica cada examen.

Uso:
    python scripts/import_sas_bank.py [fixtures_dir] [outdir]

fixtures_dir por defecto: .kairos-fixtures
outdir por defecto: app/public/data/exams

Los 12 PDF deben clasificarse de forma determinista: cada uno queda
`publicable` (paquete canónico + QA en el banco) o `bloqueado_para_revision`
(paquete canónico no consumible + QA en outdir/blocked). La salida termina con
código 0 solo si los 12 se clasifican sin errores inesperados.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from parse_sas_exam import BLOCKED, PUBLICABLE, build_exam, write_outputs

INITIAL_FIXTURES = [
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

DEFAULT_FIXTURES_DIR = Path(".kairos-fixtures")
DEFAULT_OUTDIR = Path("app/public/data/exams")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import the 12 initial SAS PDFs and classify each exam")
    parser.add_argument("fixtures_dir", type=Path, nargs="?", default=DEFAULT_FIXTURES_DIR)
    parser.add_argument("outdir", type=Path, nargs="?", default=DEFAULT_OUTDIR)
    args = parser.parse_args()

    missing = [name for name in INITIAL_FIXTURES if not (args.fixtures_dir / name).exists()]
    if missing:
        print(f"FIXTURES_MISSING: {missing}", file=sys.stderr)
        sys.exit(3)

    print(f"{'PDF':<32} {'ESTADO':<24} {'ID':<46} {'Q':>3} {'PUNTUABLES':>10}")
    publicable = 0
    blocked = 0
    processing_errors = 0
    for name in INITIAL_FIXTURES:
        pdf = args.fixtures_dir / name
        try:
            result = build_exam(pdf)
            if result.state == PUBLICABLE and result.exam is not None:
                publicable += 1
            elif result.state == BLOCKED and result.exam is not None and result.blocked_reason:
                blocked += 1
            else:
                raise RuntimeError(
                    f"resultado sin clasificar: state={result.state!r}, "
                    f"exam={'presente' if result.exam is not None else 'ausente'}, "
                    f"reason={result.blocked_reason!r}"
                )
            written = write_outputs(result, args.outdir)
        except Exception as error:  # error inesperado: no es una clasificación
            processing_errors += 1
            print(f"{name:<32} ERROR inesperado/no clasificado: {error}", file=sys.stderr)
            continue
        if result.state == PUBLICABLE:
            exam = result.exam
            print(
                f"{name:<32} {result.state:<24} {exam['id']:<46} "
                f"{len(exam['questions']):>3} {exam['scorableSet']['count']:>10}"
            )
        else:
            exam = result.exam
            print(
                f"{name:<32} {result.state:<24} {exam['id']:<46} "
                f"{len(exam['questions']):>3} {exam['scorableSet']['count']:>10} "
                f"-> {result.blocked_reason}"
            )
        for path in written:
            print(f"  generated {path}")

    print(
        f"RESULT: {publicable}/12 publicable, {blocked}/12 bloqueado con causa, "
        f"{processing_errors}/12 error/no clasificado"
    )
    sys.exit(2 if processing_errors else 0)


if __name__ == "__main__":
    main()
