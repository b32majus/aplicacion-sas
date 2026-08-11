#!/usr/bin/env python3
"""Importa un PDF oficial SAS y publica su paquete canónico + QA en el banco.

Uso:
    python scripts/import_sas_exam.py <pdf> [outdir]

outdir por defecto: app/public/data/exams

- Estado `publicable`: escribe <exam-id>.json y <exam-id>.qa.md en outdir.
- Estado `bloqueado_para_revision`: escribe un paquete canónico no consumible
  más QA en outdir/blocked/ y termina con código de salida 2 (sin alias ni catálogo).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from parse_sas_exam import build_exam, write_outputs

DEFAULT_OUTDIR = Path("app/public/data/exams")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import one official SAS PDF into the exam bank")
    parser.add_argument("pdf", type=Path, help="PDF oficial del examen")
    parser.add_argument(
        "outdir",
        type=Path,
        nargs="?",
        default=DEFAULT_OUTDIR,
        help="directorio del banco (por defecto app/public/data/exams)",
    )
    args = parser.parse_args()

    result = build_exam(args.pdf)
    written = write_outputs(result, args.outdir)
    for path in written:
        print(f"Generated {path}")
    print(f"STATE: {result.state}")
    if result.state == "bloqueado_para_revision":
        print(f"REASON: {result.blocked_reason}")
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
