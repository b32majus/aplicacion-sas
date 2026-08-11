#!/usr/bin/env python3
"""Importador real Seam 1: PDF oficial SAS -> paquete canónico de examen + QA.

Cada PDF oficial entra por este módulo y sale un paquete canónico (JSON) más un
informe QA y un estado explícito `publicable` o `bloqueado_para_revision`.

Principios del contrato (SPEC v2 / CONTEXT):
- La plantilla oficial de respuestas es la autoridad.
- Nunca se corrige ni se inventa contenido de la fuente: las incidencias de
  texto menores quedan registradas en QA y el texto original se conserva.
- Las anuladas quedan inactivas conservando el salto de numeración fuente.
- Las reservas solo entran en el conjunto puntuable con evidencia en la fuente;
  sin evidencia permanecen inactivas conservando su numeración fuente.
- Respuestas ausentes, opciones inválidas, recuentos irreconciliables o
  anulación/reservas ambiguas bloquean explícitamente (`bloqueado_para_revision`).
- La versión inmutable combina el hash de la fuente y el contenido final.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
import unicodedata
import uuid
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF
import jsonschema

SCHEMA_VERSION = "2.0"
CATEGORY = "Administrativo/a"
ACCESS_LABELS = {
    "turno-libre": "Turno Libre",
    "promocion-interna": "Promoción Interna",
}
VARIANT_LABEL = "Prueba Aplazada"

OPTION_RE = re.compile(r"^\s*([A-F])\)\s*(.*)$")
STANDALONE_NUMBER_RE = re.compile(r"^\s*(\d{1,4})\s*$")
# Número de pregunta pegado al inicio de la línea de texto de la pregunta
# (p. ej. "51 Según Pacto..." o "134 ¿Cuál..."). Solo se acepta si el número
# va seguido de mayúscula/¿" para no confundir líneas de texto que empiezan
# por un número en minúscula ("13 de diciembre...", "100 ml.").
ATTACHED_NUMBER_RE = re.compile(r"^\s*(\d{1,4})\s+([A-ZÁÉÍÓÚÑÜ¿\"'])")
PAGE_HEADER_RE = re.compile(r"^P[aá]gina\s+\d+\s+de\s+\d+$", re.IGNORECASE)
RESERVE_RANGE_RE = re.compile(r"de la\s+(1\d{2})\s+a\s+la\s+(1\d{2})", re.IGNORECASE)
RESERVE_SUBSTITUTION_RE = re.compile(
    r"pregunta\s+de\s+reserva\s+(\d{1,4})\s+sustituye\s+a\s+la\s+"
    r"pregunta\s+anulada\s+(\d{1,4})",
    re.IGNORECASE,
)
RESERVE_SET_STATEMENT_RE = re.compile(
    r"Esta prueba consta de [^.]{0,300}?(?:\d+ de reserva|preguntas? de reserva)[^.]{0,200}?"
    r"numeradas? de la\s+(1\d{2})\s+a\s+la\s+(1\d{2})\.",
    re.IGNORECASE,
)
RESERVE_INSTRUCTION_RE = re.compile(
    r"Las preguntas de reserva deben ser contestadas[^.]{0,300}?"
    r"numeradas? de la\s+(1\d{2})\s+a\s+la\s+(1\d{2})\.",
    re.IGNORECASE,
)
ORDINARY_RANGE_RE = re.compile(r"numeradas? de la\s+(\d+)\s+a\s+la\s+(\d+)", re.IGNORECASE)
YEAR_HEADER_RE = re.compile(r"(?:SAS_?)?ADMINISTRATIVO/A\s*[/\-]?\s*(20\d{2})", re.IGNORECASE)
YEAR_RESOLUTION_RE = re.compile(r"Resoluci[oó]n de \d{1,2} de \w+ de (20\d{2})")
YEAR_FOOTER_RE = re.compile(r"(?:SAS_?)?ADMINISTRATIVO/A[^\n]{0,30}?(20\d{2})", re.IGNORECASE)
DURATION_MINUTES_RE = re.compile(r"duraci[oó]n[^.\n]{0,160}?\((\d{2,3})\s*minutos\)", re.IGNORECASE)
DURATION_THREE_HOURS_RE = re.compile(r"duraci[oó]n[^.\n]{0,160}?tres horas", re.IGNORECASE)
DURATION_TWO_HOURS_RE = re.compile(r"duraci[oó]n[^.\n]{0,160}?dos horas", re.IGNORECASE)
DURATION_N_HOURS_RE = re.compile(r"duraci[oó]n[^.\n]{0,160}?(\d+)\s*horas", re.IGNORECASE)

HEADER_LINES = {
    "CUESTIONARIO",
    "TEÓRICO",
    "PRÁCTICO",
    "TEÓRICO-PRÁCTICO",
    "TEÓRICO/PRÁCTICO",
    "RESERVA",
    "DEFINITIVA",
    "PREGUNTAS ACCESO LIBRE",
    "PREGUNTAS ACCESO PROMOCIÓN INTERNA",
    "ADMINISTRATIVO/A",
    "CUESTIONARIO TEÓRICO",
    "CUESTIONARIO PRÁCTICO",
    "CUESTIONARIO RESERVA",
    "CUESTIONARIO TEÓRICO-PRÁCTICO",
    "CUESTIONARIO TEÓRICO/PRÁCTICO",
    "PROMOCIÓN INTERNA",
    "PROMOCIÓN INTERNA /",
    "PROMOCION INTERNA",
    "EXAMEN APLAZADO",
    "PRUEBA APLAZADA",
    "PRUEBA ÚNICA",
    "PRUEBA: CUESTIONARIO TEÓRICO/PRÁCTICO",
    "ACCESO: LIBRE",
    "ACCESO: PROMOCIÓN INTERNA",
}
HEADER_PREFIXES = (
    "SAS_",
    "TURNO ",
    "ADMINISTRATIVO/A",
    "OEP ",
    "PREGUNTAS ACCESO",
    "PROMOCI",
    "EXAMEN APLAZADO",
    "PRUEBA APLAZADA",
)

# Cabeceras/macetación que pueden aparecer con guion o barra final
# (p. ej. "TEÓRICO-", "PRÁCTICO ", "APLAZADO").
HEADER_TOKEN_RE = re.compile(
    r"^(CUESTIONARIO|TE[ÓO]RICO|PR[AÁ]CTICO|RESERVA|DEFINITIVA|APLAZAD[OA]?"
    r"|PRUEBA APLAZADA|EXAMEN APLAZADO|PROMOCI[ÓO]N INTERNA|PROMOCION INTERNA"
    r"|PREGUNTAS ACCESO (?:LIBRE|PROMOCI[ÓO]N INTERNA)|ACCESO: (?:LIBRE|PROMOCI[ÓO]N INTERNA)"
    r"|TURNO LIBRE)[\s\-/]*$"
)

# Una línea de texto se considera continuación de la última opción cuando su
# margen izquierdo supera al de la opción en al menos estos puntos; en caso
# contrario es texto de la pregunta (margen del enunciado).
CONTINUATION_EPS = 3.0

# Encabezado de los bloques de caso práctico (p. ej. "CASO PRACTICO 1:"), que
# preceden a las preguntas de la prueba práctica en las convocatorias 2021.
CASE_LABEL_RE = re.compile(r"^\s*CASO\s+(?:PR[AÁ]CTICO|PRACTICO)\s*\d+\s*:?", re.IGNORECASE)

BLOCKED = "bloqueado_para_revision"
PUBLICABLE = "publicable"

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schemas" / "exam.schema.json"


class ImportBlockedError(Exception):
    """Bloqueo explícito del importador: motivo concreto para revisión humana."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class CanonicalPackageError(ValueError):
    """El paquete no satisface el contrato público canónico."""


@dataclass
class Segment:
    number: int
    source_page: int
    lines: list[str] = field(default_factory=list)


@dataclass
class ImportResult:
    exam: dict[str, Any] | None
    qa: dict[str, Any]
    state: str
    blocked_reason: str | None


def normalize_text(text: str) -> str:
    text = text.replace("\u00a0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:?!])", r"\1", text)
    return text


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower().replace("/a", "").replace("/", "-")
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text


def is_header_line(line: str) -> bool:
    compact = normalize_text(line)
    if not compact or PAGE_HEADER_RE.match(compact) or compact in HEADER_LINES:
        return True
    if compact.startswith(HEADER_PREFIXES):
        return True
    if HEADER_TOKEN_RE.match(compact):
        return True
    if compact in {"Turno Libre", "Promoción Interna", "P. Interna", "Promocion Interna"}:
        return True
    return False


def page_text(doc: fitz.Document, index: int) -> str:
    return doc[index].get_text("text")


def find_answer_key_page(doc: fitz.Document) -> int:
    """Página de la plantilla definitiva: última página que menciona anuladas
    (las plantillas definitivas contienen valores ANULADA); si no existe,
    última página con 'Plantilla'."""
    candidates = [i for i in range(len(doc)) if "ANULAD" in page_text(doc, i).upper()]
    if candidates:
        return candidates[-1]
    candidates = [i for i in range(len(doc)) if "Plantilla" in page_text(doc, i)]
    if candidates:
        return candidates[-1]
    raise ImportBlockedError("no se encontró la página de la plantilla oficial de respuestas")


def extract_answer_key(doc: fitz.Document, answer_page: int) -> dict[int, str]:
    """Extrae pares (número, respuesta) de la plantilla definitiva."""
    raw = page_text(doc, answer_page)
    tokens = [normalize_text(x) for x in raw.splitlines()]
    tokens = [
        t
        for t in tokens
        if t
        and (t.isdigit() or re.fullmatch(r"[A-F]", t.upper()) or t.upper() == "ANULADA")
    ]
    answers: dict[int, str] = {}
    duplicated: list[tuple[int, str, str]] = []
    i = 0
    while i < len(tokens) - 1:
        if tokens[i].isdigit() and (
            re.fullmatch(r"[A-F]", tokens[i + 1].upper()) or tokens[i + 1].upper() == "ANULADA"
        ):
            number = int(tokens[i])
            value = tokens[i + 1].upper()
            if number in answers:
                duplicated.append((number, answers[number], value))
            else:
                answers[number] = value
            i += 2
        else:
            i += 1
    if not answers:
        raise ImportBlockedError("no se pudieron extraer respuestas oficiales de la plantilla")
    for number, first, second in duplicated:
        if first != second:
            raise ImportBlockedError(
                f"la plantilla oficial asigna a la pregunta {number} respuestas "
                f"distintas ({first} y {second})"
            )
    return answers


def detect_metadata(doc: fitz.Document) -> dict[str, Any]:
    """Categoría, acceso, variante, año, id y título canónicos derivados del PDF."""
    first_pages = "\n".join(page_text(doc, i) for i in range(min(len(doc), 6)))
    full_text = "\n".join(page_text(doc, i) for i in range(len(doc)))

    year: int | None = None
    year_match = YEAR_HEADER_RE.search(first_pages)
    if year_match:
        year = int(year_match.group(1))
    if year is None:
        year_match = YEAR_RESOLUTION_RE.search(first_pages)
        if year_match:
            year = int(year_match.group(1))
    if year is None:
        year_match = YEAR_FOOTER_RE.search(full_text)
        if year_match:
            year = int(year_match.group(1))

    access: str | None = None
    probe = first_pages + "\n" + page_text(doc, min(6, len(doc) - 1))
    access_patterns = [
        (r"ACCESO\s*:?\s*(?:AL\s+)?(LIBRE)", "turno-libre"),
        (r"ACCESO\s*:?\s*(PROMOCI[ÓO]N\s+INTERNA)", "promocion-interna"),
        (r"TURNO\s+LIBRE", "turno-libre"),
        (r"P\.?\s*INTERNA", "promocion-interna"),
        (r"PROMOCI[ÓO]N\s+INTERNA", "promocion-interna"),
        (r"PROMOCION\s+INTERNA", "promocion-interna"),
        (r"ACCESO\s+LIBRE", "turno-libre"),
    ]
    for pattern, slug in access_patterns:
        if re.search(pattern, probe, re.IGNORECASE):
            access = slug
            break
    if access is None:
        access_match = re.search(
            r"(?:Acceso|Turno)\s*(?:a\s*)?(Libre|Promoci[óo]n Interna|Promocion Interna)",
            full_text,
            re.IGNORECASE,
        )
        if access_match:
            access = "turno-libre" if "libre" in access_match.group(1).lower() else "promocion-interna"

    variant = VARIANT_LABEL if re.search(r"APLAZAD", full_text, re.IGNORECASE) else None

    return {
        "category": CATEGORY,
        "access": access,
        "access_slug": access,
        "variant": variant,
        "year": year,
    }


def detect_duration(doc: fitz.Document) -> int | None:
    cover = "\n".join(page_text(doc, i) for i in range(min(len(doc), 3)))
    match = DURATION_MINUTES_RE.search(cover)
    if match:
        return int(match.group(1))
    if DURATION_THREE_HOURS_RE.search(cover):
        return 180
    if DURATION_TWO_HOURS_RE.search(cover):
        return 120
    match = DURATION_N_HOURS_RE.search(cover)
    if match:
        return int(match.group(1)) * 60
    return None


def detect_question_ranges(
    doc: fitz.Document, answer_numbers: set[int]
) -> tuple[set[int], set[int], list[tuple[int, int]]]:
    """Rangos ordinarios y de reserva declarados en el cuadernillo.

    Ordinarias: rangos 'numeradas de la A a la B' cuyo fin es <= 150 (las dos
    pruebas de los exámenes de 150 preguntas se declaran numeradas 1-100 y
    101-150). Reserva: el rango declarado para las preguntas de reserva, que
    siempre empieza por encima de 150 (normalmente 151-153).
    """
    cover = "\n".join(page_text(doc, i) for i in range(min(len(doc), 3)))
    ordinary: set[int] = set()
    for match in ORDINARY_RANGE_RE.finditer(cover):
        start, end = int(match.group(1)), int(match.group(2))
        if end <= 150 and start <= end:
            ordinary.update(range(start, end + 1))
    reserve: set[int] = set()
    for match in RESERVE_RANGE_RE.finditer(cover):
        start, end = int(match.group(1)), int(match.group(2))
        if start > 150 and start <= end:
            reserve.update(range(start, end + 1))
    if not reserve:
        # Sin declaración explícita, la reserva son los números de la plantilla
        # que superan el máximo ordinario declarado.
        if ordinary:
            reserve = {n for n in answer_numbers if n > max(ordinary)}
    if not ordinary and not reserve:
        raise ImportBlockedError(
            "no se pudo determinar el rango de preguntas ordinarias/reserva en el cuadernillo"
        )
    # Una instrucción genérica para contestar todas las reservas no demuestra
    # cuáles sustituyen anulaciones concretas. Solo una relación explícita y
    # específica del propio examen sirve como evidencia de sustitución.
    full_text = normalize_text("\n".join(page_text(doc, i) for i in range(len(doc))))
    substitutions = [
        (int(match.group(1)), int(match.group(2)))
        for match in RESERVE_SUBSTITUTION_RE.finditer(full_text)
    ]
    return ordinary, reserve, substitutions


def _source_statement(
    doc: fitz.Document, pattern: re.Pattern[str], page_indexes: range
) -> tuple[int, re.Match[str]] | None:
    for page_index in page_indexes:
        match = pattern.search(normalize_text(page_text(doc, page_index)))
        if match:
            return page_index + 1, match
    return None


def _reserve_use_evidence(
    doc: fitz.Document,
    reserve_numbers: list[int],
    annulled_numbers: list[int],
    answer_page_index: int,
    substitutions: list[tuple[int, int]],
) -> dict[str, Any] | None:
    """Materializa únicamente evidencia comprobable en la fuente oficial.

    La igualdad de cardinalidades no basta por sí sola. La vía sin mapeo exige
    además la declaración oficial del conjunto de reserva, la instrucción de
    contestarlo y una plantilla marcada como definitiva con el conjunto exacto
    de anuladas. Juntas, esas piezas hacen necesario usar todas las reservas.
    """
    cover_pages = range(min(len(doc), 3))
    declaration = _source_statement(doc, RESERVE_SET_STATEMENT_RE, cover_pages)
    if declaration is None:
        return None
    declaration_page, declaration_match = declaration
    declared_numbers = list(
        range(int(declaration_match.group(1)), int(declaration_match.group(2)) + 1)
    )
    if declared_numbers != reserve_numbers:
        return None

    answer_key_text = normalize_text(page_text(doc, answer_page_index))
    if not re.search(
        r"(?:Plantilla|Planilla) de Respuestas\s+Definitiva|Definitiva",
        answer_key_text,
        re.IGNORECASE,
    ):
        return None

    mapping_evidence: list[dict[str, Any]] = []
    if substitutions:
        instruction_pages: list[int] = []
        instruction_texts: list[str] = []
        for reserve_number, annulled_number in substitutions:
            statement_pattern = re.compile(
                rf"La pregunta de reserva {reserve_number} sustituye a la pregunta anulada "
                rf"{annulled_number}\.?”?",
                re.IGNORECASE,
            )
            statement = _source_statement(doc, statement_pattern, range(len(doc)))
            if statement is None:
                return None
            source_page, match = statement
            source_text = match.group(0)
            instruction_pages.append(source_page)
            instruction_texts.append(source_text)
            mapping_evidence.append(
                {
                    "reserveNumber": reserve_number,
                    "annulledNumber": annulled_number,
                    "sourcePage": source_page,
                    "sourceText": source_text,
                }
            )
        return {
            "basis": "explicit_source_substitutions",
            "sourcePages": sorted(
                {declaration_page, answer_page_index + 1, *instruction_pages}
            ),
            "reserveDeclarationPage": declaration_page,
            "reserveInstructionPage": instruction_pages[0],
            "definitiveAnswerKeyPage": answer_page_index + 1,
            "sourceDeclaredReserveNumbers": reserve_numbers,
            "sourceDeclaredReserveSetText": declaration_match.group(0),
            "sourceUseInstructionText": " ".join(instruction_texts),
            "definitiveKeyAnnulledNumbers": annulled_numbers,
            "substitutions": mapping_evidence,
            "rationale": (
                "La fuente identifica de forma explícita cada reserva utilizada y la "
                "pregunta anulada a la que sustituye."
            ),
        }

    instruction = _source_statement(doc, RESERVE_INSTRUCTION_RE, cover_pages)
    if instruction is None or len(annulled_numbers) != len(reserve_numbers) or not reserve_numbers:
        return None
    instruction_page, instruction_match = instruction
    instructed_numbers = list(
        range(int(instruction_match.group(1)), int(instruction_match.group(2)) + 1)
    )
    if instructed_numbers != reserve_numbers:
        return None
    count = len(reserve_numbers)
    return {
        "basis": "all_declared_reserves_required",
        "sourcePages": sorted(
            {declaration_page, instruction_page, answer_page_index + 1}
        ),
        "reserveDeclarationPage": declaration_page,
        "reserveInstructionPage": instruction_page,
        "definitiveAnswerKeyPage": answer_page_index + 1,
        "sourceDeclaredReserveNumbers": reserve_numbers,
        "sourceDeclaredReserveSetText": declaration_match.group(0),
        "sourceUseInstructionText": instruction_match.group(0),
        "definitiveKeyAnnulledNumbers": annulled_numbers,
        "substitutions": [],
        "rationale": (
            f"La fuente declara e instruye contestar exactamente {count} reservas y la "
            f"plantilla definitiva anula exactamente {count} preguntas ordinarias; por "
            "tanto, todos los puestos de reserva declarados son necesarios y el conjunto "
            "activo de reservas queda determinado sin inventar emparejamientos."
        ),
    }


def page_lines_with_x0(doc: fitz.Document, page_index: int) -> list[tuple[float, str]]:
    """Líneas de la página con su margen izquierdo (x0), en orden de lectura."""
    lines: list[tuple[float, str]] = []
    data = doc[page_index].get_text("dict")
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            if not spans:
                continue
            text = "".join(span.get("text", "") for span in spans)
            x0 = min(span["bbox"][0] for span in spans)
            lines.append((x0, text))
    return lines


def detect_number_layout(doc: fitz.Document, answer_page: int) -> str:
    """Formato real de numeración del cuadernillo.

    - "first": el número precede al enunciado (2015/2021/2023/2025/APL/AP).
    - "after": el número va tras el enunciado, antes de las opciones (2018).
    Se determina en la primera página de cuestionario comparando la posición de
    la primera línea de texto con la del primer número.
    """
    for page_index in range(answer_page):
        page_lines = [line for _, line in page_lines_with_x0(doc, page_index)]
        if not any(OPTION_RE.match(line) for line in page_lines):
            continue
        first_number = None
        first_text = None
        for index, line in enumerate(page_lines):
            if is_header_line(line):
                continue
            stripped = line.strip()
            if STANDALONE_NUMBER_RE.match(stripped):
                if first_number is None:
                    first_number = index
                continue
            if OPTION_RE.match(stripped):
                continue
            if stripped and first_text is None:
                first_text = index
        if first_number is not None:
            if first_text is not None and first_text < first_number:
                return "after"
            return "first"
    return "first"


def extract_question_segments(
    doc: fitz.Document, answer_page: int, layout: str = "first"
) -> list[Segment]:
    """Segmentos de pregunta del cuestionario.

    Soporta los dos formatos reales de numeración:
    - "first" (número delante del enunciado): cualquier línea de texto tras la
      última opción es continuación de opción;
    - "after" (número detrás del enunciado, formato 2018): el texto que precede
      al número pertenece a la pregunta que ese número identifica; una línea de
      texto con margen claramente mayor que el de la última opción es
      continuación de esa opción, y el resto es enunciado de la próxima pregunta.

    Los bloques "CASO PRÁCTICO N:" (prueba práctica de las convocatorias 2021)
    y su narración se conservan íntegros: se anexan al enunciado de la primera
    pregunta numerada posterior, sin perder contenido de la fuente.
    """
    segments: list[Segment] = []
    current: Segment | None = None
    pending: list[str] = []
    last_option_x0: float | None = None
    in_case_narrative = False

    for page_index in range(answer_page):
        page_lines = page_lines_with_x0(doc, page_index)
        if not any(OPTION_RE.match(line) for _, line in page_lines):
            continue
        for x0, raw_line in page_lines:
            if is_header_line(raw_line):
                continue
            line = raw_line.strip()
            standalone = STANDALONE_NUMBER_RE.match(line)
            attached = None if standalone else ATTACHED_NUMBER_RE.match(line)
            if standalone or attached:
                number = int((standalone or attached).group(1))
                if 1 <= number <= 999:
                    if current is not None:
                        segments.append(current)
                    if attached:
                        # El número iba pegado al inicio de la línea: se conserva
                        # el texto de la pregunta sin el número fuente.
                        stripped = attached.group(2) + line[attached.end():]
                        current = Segment(number, page_index + 1, pending + [stripped])
                    else:
                        current = Segment(number, page_index + 1, pending)
                    pending = []
                    last_option_x0 = None
                    in_case_narrative = False
                    continue
            option_match = OPTION_RE.match(line)
            if option_match:
                if current is not None:
                    current.lines.append(line)
                    last_option_x0 = x0
                continue
            if not line:
                continue
            if CASE_LABEL_RE.match(line):
                # Bloque de caso práctico: su narración se conserva íntegra y
                # se anexa al enunciado de la siguiente pregunta numerada.
                in_case_narrative = True
                pending.append(line)
                continue
            if in_case_narrative:
                pending.append(line)
                continue
            # Línea de texto: continuación de opción, enunciado de la pregunta
            # actual (número delante) o enunciado de la próxima pregunta
            # (número detrás, formato 2018).
            if current is None:
                pending.append(line)
            elif last_option_x0 is None:
                current.lines.append(line)
            elif layout == "after" and x0 > last_option_x0 + CONTINUATION_EPS:
                current.lines.append(line)
            elif layout == "after":
                pending.append(line)
            else:
                current.lines.append(line)

    if current is not None:
        segments.append(current)
    return segments


def parse_question(segment: Segment, exam_id: str) -> dict[str, Any]:
    question_lines: list[str] = []
    options: list[dict[str, str]] = []
    current_option: dict[str, str] | None = None

    for line in segment.lines:
        if not line:
            continue
        option_match = OPTION_RE.match(line)
        if option_match:
            current_option = {"id": option_match.group(1), "text": normalize_text(option_match.group(2))}
            options.append(current_option)
        elif current_option is None:
            question_lines.append(line)
        else:
            current_option["text"] = normalize_text(current_option["text"] + " " + line)

    question_text = normalize_text(" ".join(question_lines))
    return {
        "id": f"{exam_id}-q{segment.number:03d}",
        "sourceNumber": segment.number,
        "text": question_text,
        "options": options,
        "sourceAnswer": None,
        "correctOption": None,
        "status": "valid",
        "active": False,
        "displayLabel": None,
        "sourcePage": segment.source_page,
    }


def source_flags(question: dict[str, Any]) -> list[dict[str, Any]]:
    flags: list[dict[str, Any]] = []
    for option in question["options"]:
        match = re.search(r"[.!?]\s+([a-záéíóúñü]{3,25}[.!?])$", option["text"])
        if match and len(match.group(1)) <= 25:
            flags.append(
                {
                    "question": question["sourceNumber"],
                    "option": option["id"],
                    "flag": f"option_{option['id']}_suspicious_trailing_fragment:{match.group(1)}",
                    "sourcePage": question["sourcePage"],
                }
            )
    return flags


def build_canonical_package(
    pdf_path: Path,
    metadata: dict[str, Any],
    answers: dict[int, str],
    segments: list[Segment],
    duration_minutes: int,
    answer_page_index: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Construye el paquete canónico validando todos los invariantes de dominio.

    Devuelve (exam, flags). Los bloqueos duros lanzan ImportBlockedError.
    """
    year = metadata["year"]
    access_slug = metadata["access_slug"]
    variant = metadata["variant"]
    exam_id = f"sas-{slugify(metadata['category'])}-{year}-{access_slug}"
    if variant:
        exam_id += "-aplazada"
    access_label = ACCESS_LABELS.get(access_slug, access_slug)
    title = f"SAS {metadata['category']} {year} - {access_label}"
    if variant:
        title += f" - {variant}"

    # --- segmentos -> preguntas -------------------------------------------------
    parsed_by_number: dict[int, dict[str, Any]] = {}
    duplicate_flags: list[dict[str, Any]] = []
    for segment in segments:
        question = parse_question(segment, exam_id)
        number = question["sourceNumber"]
        if number in parsed_by_number:
            previous = parsed_by_number[number]
            if previous["text"] == question["text"] and previous["options"] == question["options"]:
                # Capa de texto duplicada idéntica: se conserva una copia y la
                # incidencia entra en QA (nunca se corrige contenido).
                duplicate_flags.append(
                    {
                        "question": number,
                        "option": None,
                        "flag": "question_duplicated_in_source_text_layer_identical",
                        "sourcePage": segment.source_page,
                    }
                )
                continue
            raise ImportBlockedError(
                f"la pregunta {number} aparece duplicada en el PDF con contenido distinto"
            )
        parsed_by_number[number] = question

    # --- recuento contra la plantilla -------------------------------------------
    answer_numbers = set(answers)
    parsed_numbers = set(parsed_by_number)
    missing_questions = sorted(answer_numbers - parsed_numbers)
    extra_questions = sorted(parsed_numbers - answer_numbers)
    if missing_questions or extra_questions:
        parts = []
        if missing_questions:
            parts.append(f"preguntas de la plantilla sin cuestionario: {missing_questions}")
        if extra_questions:
            parts.append(f"preguntas del cuestionario sin plantilla: {extra_questions}")
        raise ImportBlockedError("recuento irreconciliable: " + "; ".join(parts))

    with fitz.open(pdf_path) as _doc_for_ranges:
        ordinary_range, reserve_range, reserve_substitutions = detect_question_ranges(
            _doc_for_ranges, answer_numbers
        )
    declared_numbers = ordinary_range | reserve_range
    missing_from_key = sorted(declared_numbers - answer_numbers)
    outside_declared_ranges = sorted(answer_numbers - declared_numbers)
    if missing_from_key or outside_declared_ranges:
        parts = []
        if missing_from_key:
            parts.append(f"números declarados sin plantilla: {missing_from_key}")
        if outside_declared_ranges:
            parts.append(f"números de plantilla fuera de rangos declarados: {outside_declared_ranges}")
        raise ImportBlockedError("recuento irreconciliable con los rangos del cuadernillo: " + "; ".join(parts))

    # --- estados: anuladas, reservas, activas ------------------------------------
    flags: list[dict[str, Any]] = duplicate_flags
    reserve_numbers = sorted(n for n in answer_numbers if n in reserve_range)
    reserve_set = set(reserve_numbers)

    questions: list[dict[str, Any]] = []
    for number in sorted(answer_numbers):
        question = parsed_by_number[number]
        answer = answers[number]
        question["sourceAnswer"] = answer
        if number in reserve_set:
            question["status"] = "reserve"
            question["active"] = False
            question["displayLabel"] = None
            question["correctOption"] = None if answer == "ANULADA" else answer
        elif answer == "ANULADA":
            question["status"] = "annulled"
            question["active"] = False
            question["displayLabel"] = None
            question["correctOption"] = None
        else:
            question["status"] = "valid"
            question["active"] = True
            question["displayLabel"] = None
            question["correctOption"] = answer
        questions.append(question)
        flags.extend(source_flags(question))

    # --- validaciones estructurales ----------------------------------------------
    for question in questions:
        ids = [option["id"] for option in question["options"]]
        if ids != ["A", "B", "C", "D"]:
            raise ImportBlockedError(
                f"la pregunta {question['sourceNumber']} no tiene las 4 opciones A-D "
                f"(encontradas: {ids or 'ninguna'})"
            )
        if not question["text"]:
            raise ImportBlockedError(f"la pregunta {question['sourceNumber']} no tiene texto")
        if question["status"] != "annulled" and question["correctOption"] not in ids:
            raise ImportBlockedError(
                f"la pregunta {question['sourceNumber']} tiene respuesta oficial "
                f"{question['correctOption']} sin opción correspondiente"
            )

    # --- anuladas y reservas: resolución verificable ------------------------------
    annulled_numbers = [q["sourceNumber"] for q in questions if q["status"] == "annulled"]
    if len(annulled_numbers) > len(reserve_numbers):
        raise ImportBlockedError(
            "tratamiento irreconciliable de anuladas/reservas: reservas insuficientes "
            f"({len(annulled_numbers)} anuladas, {len(reserve_numbers)} reservas declaradas)"
        )
    reserve_used_numbers: list[int]
    reserve_use_evidence: dict[str, Any] | None = None
    if annulled_numbers:
        if not reserve_substitutions:
            with fitz.open(pdf_path) as evidence_doc:
                reserve_use_evidence = _reserve_use_evidence(
                    evidence_doc,
                    reserve_numbers,
                    annulled_numbers,
                    answer_page_index,
                    reserve_substitutions,
                )
            if reserve_use_evidence is None:
                raise ImportBlockedError(
                    "tratamiento ambiguo de anuladas/reservas: la fuente no contiene "
                    "evidencia explícita y específica de qué reserva sustituye cada anulada"
                )
            reserve_used_numbers = reserve_numbers
        else:
            mapped_reserves = [reserve for reserve, _ in reserve_substitutions]
            mapped_annulled = [annulled for _, annulled in reserve_substitutions]
            if len(set(mapped_reserves)) != len(mapped_reserves) or len(set(mapped_annulled)) != len(mapped_annulled):
                raise ImportBlockedError(
                    "tratamiento ambiguo de anuladas/reservas: evidencia de sustitución duplicada"
                )
            if set(mapped_reserves) - reserve_set:
                raise ImportBlockedError(
                    "tratamiento ambiguo de anuladas/reservas: la evidencia menciona reservas "
                    f"no declaradas {sorted(set(mapped_reserves) - reserve_set)}"
                )
            if set(mapped_annulled) != set(annulled_numbers):
                raise ImportBlockedError(
                    "tratamiento ambiguo de anuladas/reservas: la evidencia explícita no cubre "
                    f"exactamente las anuladas {annulled_numbers}"
                )
            reserve_used_numbers = sorted(mapped_reserves)
            with fitz.open(pdf_path) as evidence_doc:
                reserve_use_evidence = _reserve_use_evidence(
                    evidence_doc,
                    reserve_numbers,
                    annulled_numbers,
                    answer_page_index,
                    reserve_substitutions,
                )
            if reserve_use_evidence is None:
                raise ImportBlockedError(
                    "tratamiento ambiguo de anuladas/reservas: no se pudo materializar "
                    "la evidencia explícita de sustitución de la fuente"
                )
    elif reserve_substitutions:
        raise ImportBlockedError(
            "tratamiento ambiguo de anuladas/reservas: la fuente declara sustituciones "
            "pero la plantilla no contiene preguntas anuladas"
        )
    else:
        reserve_used_numbers = []

    reserve_used_labels = {
        f"R{index}": number for index, number in enumerate(reserve_used_numbers, start=1)
    }
    reserve_labels_by_number = {number: label for label, number in reserve_used_labels.items()}
    for question in questions:
        if question["sourceNumber"] in reserve_labels_by_number:
            question["active"] = True
            question["displayLabel"] = reserve_labels_by_number[question["sourceNumber"]]

    scorable_numbers = [q["sourceNumber"] for q in questions if q["active"]]

    sha256 = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    exam_without_content_hash = {
        "schemaVersion": SCHEMA_VERSION,
        "id": exam_id,
        "title": title,
        "category": metadata["category"],
        "access": access_label,
        "variant": variant,
        "year": year,
        "durationMinutes": duration_minutes,
        "source": {
            "pdf": pdf_path.name,
            "sha256": sha256,
            "answerKeyPage": answer_page_index + 1,
        },
        "version": {
            "id": None,
            "contentSha256": None,
        },
        "questions": questions,
        "scorableSet": {
            "state": "resolved",
            "questionNumbers": scorable_numbers,
            "count": len(scorable_numbers),
            "annulledNumbers": annulled_numbers,
            "reserveNumbers": reserve_numbers,
            "reserveUsedNumbers": reserve_used_numbers,
            "reserveUsedLabels": reserve_used_labels,
            "annulledCount": len(annulled_numbers),
            "reserveTotal": len(reserve_numbers),
            "reserveUsedCount": len(reserve_used_numbers),
            "reserveUnusedCount": len(reserve_numbers) - len(reserve_used_numbers),
            "reserveUseEvidence": reserve_use_evidence,
        },
        "qa": {
            "state": PUBLICABLE,
            "blockedReason": None,
            "flags": [],
            "checks": {
                "metadataComplete": True,
                "optionsPerQuestionValid": True,
                "answerCoverageValid": True,
                "countsReconciled": True,
                "annulledHandlingResolved": True,
                "reserveHandlingResolved": True,
                "duplicatesResolved": True,
            },
        },
    }
    return exam_without_content_hash, flags


def canonical_content_sha256(exam: dict[str, Any]) -> str:
    payload = json.loads(json.dumps(exam))
    # La identidad/checksum de versión no se incluye en el contenido que
    # identifica; el resto del paquete final, incluido QA, sí queda cubierto.
    payload["version"] = {}
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _set_canonical_version(exam: dict[str, Any]) -> None:
    content_hash = canonical_content_sha256(exam)
    exam["version"]["contentSha256"] = content_hash
    exam["version"]["id"] = hashlib.sha256(
        f"{exam['source']['sha256']}:{content_hash}".encode("ascii")
    ).hexdigest()


def build_blocked_package(
    pdf_path: Path,
    metadata: dict[str, Any],
    answers: dict[int, str],
    segments: list[Segment],
    duration_minutes: int | None,
    answer_page_index: int | None,
    reason: str,
) -> dict[str, Any]:
    """Conserva lo extraído en un paquete canónico no consumible.

    Un bloqueo nunca convierte datos parciales en un conjunto puntuable: todas
    las preguntas quedan inactivas y ``scorableSet.state`` permanece
    ``unresolved``. La respuesta literal, la numeración y los estados que sí
    están sustentados por la fuente se conservan para revisión.
    """
    year = metadata.get("year")
    access_slug = metadata.get("access_slug")
    variant = metadata.get("variant")
    if year is not None and access_slug is not None:
        exam_id = f"sas-{slugify(metadata.get('category') or CATEGORY)}-{year}-{access_slug}"
        if variant:
            exam_id += "-aplazada"
    else:
        exam_id = f"sas-bloqueado-{slugify(pdf_path.stem)}"
    access_label = ACCESS_LABELS.get(access_slug) if access_slug else None
    title_parts = ["SAS", metadata.get("category") or CATEGORY]
    if year is not None:
        title_parts.append(str(year))
    if access_label:
        title_parts.extend(["-", access_label])
    if variant:
        title_parts.extend(["-", variant])

    parsed_by_number: dict[int, dict[str, Any]] = {}
    duplicate_conflict = False
    for segment in segments:
        question = parse_question(segment, exam_id)
        previous = parsed_by_number.get(question["sourceNumber"])
        if previous is None:
            parsed_by_number[question["sourceNumber"]] = question
        elif previous["text"] != question["text"] or previous["options"] != question["options"]:
            duplicate_conflict = True

    ordinary_range: set[int] = set()
    reserve_range: set[int] = set()
    try:
        with fitz.open(pdf_path) as doc:
            ordinary_range, reserve_range, _ = detect_question_ranges(doc, set(answers))
    except ImportBlockedError:
        pass

    questions: list[dict[str, Any]] = []
    flags: list[dict[str, Any]] = []
    for number in sorted(parsed_by_number):
        question = parsed_by_number[number]
        answer = answers.get(number)
        question["sourceAnswer"] = answer
        question["correctOption"] = None
        question["active"] = False
        question["displayLabel"] = None
        if answer == "ANULADA":
            question["status"] = "annulled"
        elif number in reserve_range:
            question["status"] = "reserve"
        elif number in ordinary_range:
            question["status"] = "valid"
        else:
            question["status"] = "unresolved"
        questions.append(question)
        flags.extend(source_flags(question))

    parsed_numbers = set(parsed_by_number)
    answer_numbers = set(answers)
    declared_numbers = ordinary_range | reserve_range
    option_shape_valid = all(
        [option["id"] for option in question["options"]] == ["A", "B", "C", "D"]
        and bool(question["text"])
        for question in questions
    )
    answer_coverage_valid = parsed_numbers == answer_numbers and all(
        answer == "ANULADA"
        or answer in {option["id"] for option in parsed_by_number[number]["options"]}
        for number, answer in answers.items()
        if number in parsed_by_number
    )
    counts_reconciled = (
        parsed_numbers == answer_numbers
        and bool(declared_numbers)
        and declared_numbers == answer_numbers
    )
    annulled_numbers = sorted(number for number, answer in answers.items() if answer == "ANULADA")
    reserve_numbers = sorted(number for number in (answer_numbers | parsed_numbers) if number in reserve_range)
    reason_lower = reason.lower()
    checks = {
        "metadataComplete": year is not None and access_slug is not None and duration_minutes is not None,
        "optionsPerQuestionValid": option_shape_valid,
        "answerCoverageValid": answer_coverage_valid,
        "countsReconciled": counts_reconciled,
        "annulledHandlingResolved": "anulad" not in reason_lower and "reserv" not in reason_lower,
        "reserveHandlingResolved": "reserv" not in reason_lower,
        "duplicatesResolved": not duplicate_conflict and "duplicad" not in reason_lower,
    }

    source_hash = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    exam = {
        "schemaVersion": SCHEMA_VERSION,
        "id": exam_id,
        "title": " ".join(title_parts),
        "category": metadata.get("category") or CATEGORY,
        "access": access_label,
        "variant": variant,
        "year": year,
        "durationMinutes": duration_minutes,
        "source": {
            "pdf": pdf_path.name,
            "sha256": source_hash,
            "answerKeyPage": answer_page_index + 1 if answer_page_index is not None else None,
        },
        "version": {"id": None, "contentSha256": None},
        "questions": questions,
        "scorableSet": {
            "state": "unresolved",
            "questionNumbers": [],
            "count": 0,
            "annulledNumbers": annulled_numbers,
            "reserveNumbers": reserve_numbers,
            "reserveUsedNumbers": [],
            "reserveUsedLabels": {},
            "annulledCount": len(annulled_numbers),
            "reserveTotal": len(reserve_numbers),
            "reserveUsedCount": 0,
            "reserveUnusedCount": len(reserve_numbers),
        },
        "qa": {
            "state": BLOCKED,
            "blockedReason": reason,
            "flags": flags,
            "checks": checks,
        },
    }
    _add_source_anomalies(exam, pdf_path)
    _set_canonical_version(exam)
    return exam


def validate_exam_package(exam: dict[str, Any], source_pdf: Path | None = None) -> None:
    """Valida el contrato público, sus invariantes cruzados y sus hashes.

    ``source_pdf`` es opcional para consumidores de JSON. Cuando el productor
    conserva la fuente, permite comprobar además que ``source.sha256`` y el
    nombre trazado corresponden realmente al PDF recibido.
    """
    try:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        jsonschema.Draft202012Validator(schema).validate(exam)
    except (OSError, json.JSONDecodeError, jsonschema.ValidationError, jsonschema.SchemaError) as error:
        raise CanonicalPackageError(f"schema canónico inválido: {error}") from error

    questions = exam["questions"]
    numbers = [question["sourceNumber"] for question in questions]
    if len(numbers) != len(set(numbers)):
        raise CanonicalPackageError("sourceNumber duplicado")

    qa = exam["qa"]
    is_publicable = qa["state"] == PUBLICABLE

    for question in questions:
        number = question["sourceNumber"]
        if question["id"] != f"{exam['id']}-q{number:03d}":
            raise CanonicalPackageError(f"identidad de pregunta contradictoria: {number}")
        option_ids = [option["id"] for option in question["options"]]
        if len(option_ids) != len(set(option_ids)):
            raise CanonicalPackageError(f"opciones duplicadas: pregunta {number}")
        if not is_publicable:
            if question["active"] or question["correctOption"] is not None or question["displayLabel"] is not None:
                raise CanonicalPackageError(f"pregunta bloqueada activa o puntuable: {number}")
            continue
        if option_ids != ["A", "B", "C", "D"]:
            raise CanonicalPackageError(f"opciones contradictorias: pregunta {number}")
        status = question["status"]
        if status == "valid":
            if (
                not question["active"]
                or question["correctOption"] not in option_ids
                or question["sourceAnswer"] != question["correctOption"]
                or question["displayLabel"] is not None
            ):
                raise CanonicalPackageError(f"estado válido contradictorio: pregunta {number}")
        elif status == "annulled":
            if (
                question["active"]
                or question["sourceAnswer"] != "ANULADA"
                or question["correctOption"] is not None
                or question["displayLabel"] is not None
            ):
                raise CanonicalPackageError(f"pregunta anulada activa o puntuable: {number}")
        elif question["correctOption"] not in option_ids or question["sourceAnswer"] != question["correctOption"]:
            raise CanonicalPackageError(f"reserva sin respuesta oficial válida: pregunta {number}")

    scorable = exam["scorableSet"]
    if not is_publicable:
        if (
            scorable["state"] != "unresolved"
            or scorable["questionNumbers"]
            or scorable["count"] != 0
            or scorable["reserveUsedNumbers"]
            or scorable["reserveUsedLabels"]
            or scorable["reserveUsedCount"] != 0
            or scorable["annulledCount"] != len(scorable["annulledNumbers"])
            or scorable["reserveTotal"] != len(scorable["reserveNumbers"])
            or scorable["reserveUnusedCount"] != len(scorable["reserveNumbers"])
        ):
            raise CanonicalPackageError("paquete bloqueado con conjunto puntuable contradictorio")
        known_annulled = {
            question["sourceNumber"] for question in questions if question["status"] == "annulled"
        }
        known_reserves = {
            question["sourceNumber"] for question in questions if question["status"] == "reserve"
        }
        if not known_annulled.issubset(set(scorable["annulledNumbers"])):
            raise CanonicalPackageError("anuladas extraídas ausentes del paquete bloqueado")
        if not known_reserves.issubset(set(scorable["reserveNumbers"])):
            raise CanonicalPackageError("reservas extraídas ausentes del paquete bloqueado")
    else:
        if scorable["state"] != "resolved":
            raise CanonicalPackageError("paquete publicable sin conjunto puntuable resuelto")
    active_numbers = [question["sourceNumber"] for question in questions if question["active"]]
    annulled_numbers = [question["sourceNumber"] for question in questions if question["status"] == "annulled"]
    reserve_questions = [question for question in questions if question["status"] == "reserve"]
    reserve_numbers = [question["sourceNumber"] for question in reserve_questions]
    reserve_used = [question["sourceNumber"] for question in reserve_questions if question["active"]]
    reserve_labels = {f"R{index}": number for index, number in enumerate(reserve_used, start=1)}
    reserve_evidence = scorable.get("reserveUseEvidence")

    if reserve_used:
        if not isinstance(reserve_evidence, dict):
            raise CanonicalPackageError(
                "reservas utilizadas sin cadena de evidencia oficial materializada"
            )
        required_pages = {
            reserve_evidence["reserveDeclarationPage"],
            reserve_evidence["reserveInstructionPage"],
            reserve_evidence["definitiveAnswerKeyPage"],
        }
        if (
            reserve_evidence["sourceDeclaredReserveNumbers"] != reserve_numbers
            or reserve_evidence["definitiveKeyAnnulledNumbers"] != annulled_numbers
            or reserve_evidence["definitiveAnswerKeyPage"] != exam["source"]["answerKeyPage"]
            or not required_pages.issubset(set(reserve_evidence["sourcePages"]))
        ):
            raise CanonicalPackageError(
                "evidencia oficial de reservas contradictoria con fuente o conjunto puntuable"
            )
        substitutions = reserve_evidence["substitutions"]
        if reserve_evidence["basis"] == "all_declared_reserves_required":
            if (
                substitutions
                or reserve_used != reserve_numbers
                or len(reserve_numbers) != len(annulled_numbers)
                or not reserve_numbers
            ):
                raise CanonicalPackageError(
                    "evidencia de uso total no demuestra que todas las reservas sean necesarias"
                )
        else:
            mapped_reserves = [item["reserveNumber"] for item in substitutions]
            mapped_annulled = [item["annulledNumber"] for item in substitutions]
            mapping_pages = {item["sourcePage"] for item in substitutions}
            if (
                sorted(mapped_reserves) != reserve_used
                or sorted(mapped_annulled) != annulled_numbers
                or len(mapped_reserves) != len(set(mapped_reserves))
                or len(mapped_annulled) != len(set(mapped_annulled))
                or not mapping_pages.issubset(set(reserve_evidence["sourcePages"]))
            ):
                raise CanonicalPackageError(
                    "evidencia explícita de sustitución contradictoria"
                )
    elif reserve_evidence is not None:
        raise CanonicalPackageError("evidencia de uso de reservas sin reservas utilizadas")

    expected = {
        "state": "resolved",
        "questionNumbers": active_numbers,
        "count": len(active_numbers),
        "annulledNumbers": annulled_numbers,
        "reserveNumbers": reserve_numbers,
        "reserveUsedNumbers": reserve_used,
        "reserveUsedLabels": reserve_labels,
        "annulledCount": len(annulled_numbers),
        "reserveTotal": len(reserve_numbers),
        "reserveUsedCount": len(reserve_used),
        "reserveUnusedCount": len(reserve_numbers) - len(reserve_used),
    }
    if "reserveUseEvidence" in scorable:
        expected["reserveUseEvidence"] = reserve_evidence
    if is_publicable:
        if scorable != expected:
            raise CanonicalPackageError("conjunto puntuable o recuentos contradictorios")
        if len(reserve_used) != len(annulled_numbers):
            raise CanonicalPackageError(
                "tratamiento de anuladas/reservas ambiguo: el número de reservas usadas "
                "no coincide con el de anuladas"
            )

        labels_by_number = {number: label for label, number in reserve_labels.items()}
        for question in reserve_questions:
            expected_label = labels_by_number.get(question["sourceNumber"])
            if question["displayLabel"] != expected_label:
                raise CanonicalPackageError(
                    f"etiqueta/actividad de reserva contradictoria: pregunta {question['sourceNumber']}"
                )

    if is_publicable:
        if qa["blockedReason"] is not None or not all(qa["checks"].values()):
            raise CanonicalPackageError("QA publicable contradictorio")
    else:
        if not isinstance(qa["blockedReason"], str) or not qa["blockedReason"].strip():
            raise CanonicalPackageError("QA bloqueado sin motivo")
        if all(qa["checks"].values()):
            raise CanonicalPackageError("QA bloqueado sin comprobación material pendiente")

    content_hash = canonical_content_sha256(exam)
    if exam["version"]["contentSha256"] != content_hash:
        raise CanonicalPackageError("contentSha256 no corresponde al contenido canónico")
    expected_version = hashlib.sha256(
        f"{exam['source']['sha256']}:{content_hash}".encode("ascii")
    ).hexdigest()
    if exam["version"]["id"] != expected_version:
        raise CanonicalPackageError("version.id no corresponde a los hashes de fuente y contenido")

    if source_pdf is not None:
        if exam["source"]["pdf"] != source_pdf.name:
            raise CanonicalPackageError("source.pdf no corresponde al PDF recibido")
        try:
            source_hash = hashlib.sha256(source_pdf.read_bytes()).hexdigest()
        except OSError as error:
            raise CanonicalPackageError(f"no se pudo leer source.pdf: {error}") from error
        if exam["source"]["sha256"] != source_hash:
            raise CanonicalPackageError("source.sha256 no corresponde al PDF recibido")


def build_exam(pdf_path: Path) -> ImportResult:
    """Ejecuta el importador real sobre un PDF y devuelve el resultado clasificado."""
    segments: list[Segment] = []
    answers: dict[int, str] = {}
    metadata: dict[str, Any] = {
        "category": CATEGORY,
        "access": None,
        "access_slug": None,
        "variant": None,
        "year": None,
    }
    duration_minutes: int | None = None
    answer_page_index: int | None = None
    try:
        with fitz.open(pdf_path) as doc:
            metadata = detect_metadata(doc)
            duration_minutes = detect_duration(doc)
            try:
                answer_page_index = find_answer_key_page(doc)
            except ImportBlockedError:
                layout = detect_number_layout(doc, len(doc))
                segments = extract_question_segments(doc, len(doc), layout)
                raise
            try:
                answers = extract_answer_key(doc, answer_page_index)
            except ImportBlockedError:
                layout = detect_number_layout(doc, answer_page_index)
                segments = extract_question_segments(doc, answer_page_index, layout)
                raise
            layout = detect_number_layout(doc, answer_page_index)
            segments = extract_question_segments(doc, answer_page_index, layout)

        # Bloqueos de metadatos (necesarios para una identidad canónica estable).
        if metadata["year"] is None or metadata["access_slug"] is None:
            raise ImportBlockedError(
                "metadatos incompletos: no se pudo derivar año y/o forma de acceso del PDF"
            )
        if duration_minutes is None:
            raise ImportBlockedError("duración oficial no declarada en el cuadernillo")

        exam, flags = build_canonical_package(
            pdf_path, metadata, answers, segments, duration_minutes, answer_page_index
        )
        # Anomalías de texto (no bloqueantes) entran en QA.
        for flag in flags:
            if flag not in exam["qa"]["flags"]:
                exam["qa"]["flags"].append(flag)
        _add_source_anomalies(exam, pdf_path)

        _set_canonical_version(exam)

        validate_exam_package(exam, pdf_path)

        qa = qa_from_exam(exam)
        return ImportResult(exam=exam, qa=qa, state=PUBLICABLE, blocked_reason=None)
    except ImportBlockedError as error:
        exam = build_blocked_package(
            pdf_path,
            metadata,
            answers,
            segments,
            duration_minutes,
            answer_page_index,
            error.reason,
        )
        validate_exam_package(exam, pdf_path)
        return ImportResult(
            exam=exam,
            qa=qa_from_exam(exam),
            state=BLOCKED,
            blocked_reason=error.reason,
        )


def _add_source_anomalies(exam: dict[str, Any], pdf_path: Path) -> None:
    """Anomalías de texto/macetación menores: se conservan y entran en QA.

    Solo se comparan años declarados como año de examen junto a la categoría en
    la plantilla (p. ej. "SAS_ADMINISTRATIVO/A 2024 - TURNO LIBRE"); los rangos
    OEP ("OEP 2013-2015") no son una declaración de año de examen.
    """
    try:
        with fitz.open(pdf_path) as doc:
            answer_page = exam["source"]["answerKeyPage"] - 1
            footer = page_text(doc, answer_page)
            footer_year_match = YEAR_FOOTER_RE.search(footer)
            if footer_year_match and exam["year"] is not None:
                footer_year_value = int(footer_year_match.group(1))
                if footer_year_value != exam["year"]:
                    exam["qa"]["flags"].append(
                        {
                            "question": None,
                            "option": None,
                            "flag": (
                                f"answer_key_footer_year:{footer_year_value}"
                                f"_differs_from_questionnaire_year:{exam['year']}"
                            ),
                            "sourcePage": answer_page + 1,
                        }
                    )
    except Exception:
        pass  # nunca bloquea: las anomalías son informativas


def qa_from_exam(exam: dict[str, Any]) -> dict[str, Any]:
    return {
        "examId": exam["id"],
        "sourcePdf": exam["source"]["pdf"],
        "sourceSha256": exam["source"]["sha256"],
        "state": exam["qa"]["state"],
        "blockedReason": exam["qa"]["blockedReason"],
        "version": exam["version"],
        "year": exam["year"],
        "access": exam["access"],
        "variant": exam["variant"],
        "durationMinutes": exam["durationMinutes"],
        "answerKeyPage": exam["source"]["answerKeyPage"],
        "questionCount": len(exam["questions"]),
        "statusCounts": dict(Counter(q["status"] for q in exam["questions"])),
        "activeCount": sum(1 for q in exam["questions"] if q["active"]),
        "scorableState": exam["scorableSet"]["state"],
        "scorableCount": exam["scorableSet"]["count"],
        "annulledNumbers": exam["scorableSet"]["annulledNumbers"],
        "reserveNumbers": exam["scorableSet"]["reserveNumbers"],
        "reserveUsedNumbers": exam["scorableSet"]["reserveUsedNumbers"],
        "reserveUseEvidence": exam["scorableSet"].get("reserveUseEvidence"),
        "checks": exam["qa"]["checks"],
        "flags": exam["qa"]["flags"],
    }


def qa_markdown(exam: dict[str, Any] | None, qa: dict[str, Any]) -> str:
    exam_id = qa.get("examId") or (qa.get("sourcePdf") or "examen").replace(".pdf", "")
    lines = [
        f"# Informe de importación - {exam_id}",
        "",
        f"- PDF: `{qa['sourcePdf']}`",
        f"- SHA-256: `{qa['sourceSha256']}`",
        f"- Estado: **{qa['state']}**",
    ]
    if qa.get("blockedReason"):
        lines.append(f"- Motivo de bloqueo: {qa['blockedReason']}")
    if qa.get("version"):
        lines += [
            f"- Versión inmutable (hash fuente): `{qa['version']['id']}`",
            f"- Hash de contenido canónico: `{qa['version']['contentSha256']}`",
        ]
    if qa.get("year") is not None:
        lines += [
            f"- Año: {qa['year']}",
            f"- Acceso: {qa.get('access')}",
            f"- Variante: {qa.get('variant') or '—'}",
            f"- Duración oficial: {qa.get('durationMinutes')} min",
        ]
    if qa.get("answerKeyPage"):
        lines.append(f"- Página de la plantilla oficial: {qa['answerKeyPage']}")
    if qa.get("questionCount") is not None:
        scorable_description = (
            str(qa.get("scorableCount"))
            if qa.get("scorableState") == "resolved"
            else "vacío y no consumible (resolución pendiente)"
        )
        lines += [
            f"- Preguntas importadas: {qa['questionCount']}",
            f"- Estados: `{json.dumps(qa.get('statusCounts', {}), ensure_ascii=False)}`",
            f"- Conjunto puntuable: {scorable_description}",
        ]
    if qa.get("annulledNumbers"):
        lines.append(f"- Anuladas (inactivas, numeración fuente conservada): {qa['annulledNumbers']}")
    if qa.get("reserveUsedNumbers"):
        lines.append(f"- Reservas utilizadas (activas): {qa['reserveUsedNumbers']}")
    unused_reserves = sorted(set(qa.get("reserveNumbers") or []) - set(qa.get("reserveUsedNumbers") or []))
    if unused_reserves:
        lines.append(f"- Reservas no utilizadas (inactivas): {unused_reserves}")
    evidence = qa.get("reserveUseEvidence")
    if evidence:
        lines += [
            "",
            "## Evidencia oficial de uso de reservas",
            "",
            f"- Páginas fuente: {evidence['sourcePages']}",
            (
                f"- Conjunto de reserva declarado (página "
                f"{evidence['reserveDeclarationPage']}): "
                f"{evidence['sourceDeclaredReserveNumbers']} — "
                f"“{evidence['sourceDeclaredReserveSetText']}”"
            ),
            (
                f"- Instrucción oficial (página {evidence['reserveInstructionPage']}): "
                f"“{evidence['sourceUseInstructionText']}”"
            ),
            (
                f"- Anuladas en plantilla definitiva (página "
                f"{evidence['definitiveAnswerKeyPage']}): "
                f"{evidence['definitiveKeyAnnulledNumbers']}"
            ),
            f"- Base de resolución: `{evidence['basis']}`",
            f"- Razonamiento: {evidence['rationale']}",
        ]
    lines += [
        "",
        "## Comprobaciones estructurales",
        "",
    ]
    for name, value in (qa.get("checks") or {}).items():
        lines.append(f"- {name}: {'sí' if value else 'no'}")
    lines += [
        "",
        "## Incidencias para revisión humana",
        "",
    ]
    if not qa.get("flags"):
        lines.append("No se detectaron incidencias de texto.")
    else:
        for flag in qa["flags"]:
            where = f"Pregunta {flag['question']}" if flag.get("question") else "Examen"
            if flag.get("option"):
                where += f" (opción {flag['option']})"
            page = f"página PDF {flag['sourcePage']}" if flag.get("sourcePage") else "—"
            lines.append(f"- {where} ({page}): `{flag['flag']}`")
    return "\n".join(lines) + "\n"


def _catalog_entry_from_exam(exam: dict[str, Any], latest_path: str) -> dict[str, Any]:
    return {
        "id": exam["id"],
        "title": exam["title"],
        "year": exam["year"],
        "access": exam["access"],
        "variant": exam["variant"],
        "durationMinutes": exam["durationMinutes"],
        "questionCount": exam["scorableSet"]["count"],
        "latestVersion": exam["version"]["id"],
        "latestPath": latest_path,
    }


def _validate_catalog(catalog: Any, catalog_target: Path, outdir: Path) -> None:
    if not isinstance(catalog, dict) or set(catalog) != {"schemaVersion", "exams"}:
        raise RuntimeError(f"catálogo no compatible: {catalog_target}")
    if catalog["schemaVersion"] != "1.0" or not isinstance(catalog["exams"], list):
        raise RuntimeError(f"catálogo no compatible: {catalog_target}")

    required_entry_fields = {
        "id", "title", "year", "access", "variant", "durationMinutes",
        "questionCount", "latestVersion", "latestPath",
    }
    catalog_ids: list[str] = []
    for item in catalog["exams"]:
        if not isinstance(item, dict) or set(item) != required_entry_fields:
            raise RuntimeError(f"entrada de catálogo no compatible: {catalog_target}")
        exam_id = item["id"]
        version_id = item["latestVersion"]
        if not isinstance(exam_id, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", exam_id):
            raise RuntimeError(f"id de catálogo no válido: {catalog_target}")
        if not isinstance(version_id, str) or not re.fullmatch(r"[a-f0-9]{64}", version_id):
            raise RuntimeError(f"versión de catálogo no válida: {catalog_target}")
        expected_path = f"{exam_id}/versions/{version_id}.json"
        if item["latestPath"] != expected_path:
            raise RuntimeError(f"ruta de catálogo no válida: {catalog_target}")
        if (
            not isinstance(item["title"], str) or not item["title"]
            or not isinstance(item["access"], str) or not item["access"]
            or not isinstance(item["year"], int) or isinstance(item["year"], bool)
            or not 2000 <= item["year"] <= 2100
            or not isinstance(item["durationMinutes"], int) or isinstance(item["durationMinutes"], bool)
            or item["durationMinutes"] < 1
            or not isinstance(item["questionCount"], int) or isinstance(item["questionCount"], bool)
            or item["questionCount"] < 1
            or not (item["variant"] is None or isinstance(item["variant"], str))
        ):
            raise RuntimeError(f"metadatos de catálogo no válidos: {catalog_target}")

        package_path = outdir / expected_path
        try:
            package = json.loads(package_path.read_text(encoding="utf-8"))
            validate_exam_package(package)
        except (OSError, UnicodeError, json.JSONDecodeError, CanonicalPackageError) as error:
            raise RuntimeError(f"paquete de catálogo no válido: {package_path}: {error}") from error
        if item != _catalog_entry_from_exam(package, expected_path):
            raise RuntimeError(f"entrada de catálogo no coincide con su paquete: {catalog_target}")
        catalog_ids.append(exam_id)

    if len(catalog_ids) != len(set(catalog_ids)):
        raise RuntimeError(f"catálogo con identificadores duplicados: {catalog_target}")


def _restore_backup(backup: Path, target: Path) -> None:
    """Restaura sin destruir la única copia recuperable.

    El reemplazo atómico es preferente. Si el filesystem sigue rechazando
    ``os.replace``, se intenta una copia directa verificada; ante cualquier
    fallo la copia ``.bak`` se conserva para recuperación explícita.
    """
    try:
        os.replace(backup, target)
        return
    except OSError as replace_error:
        try:
            with backup.open("rb") as source, target.open("wb") as destination:
                while chunk := source.read(1024 * 1024):
                    destination.write(chunk)
                destination.flush()
                os.fsync(destination.fileno())
            if target.read_bytes() != backup.read_bytes():
                raise OSError("la copia restaurada no coincide con el backup")
            backup.unlink()
            return
        except Exception as fallback_error:
            raise RuntimeError(
                f"no se pudo restaurar {target}; backup recuperable conservado en {backup}: "
                f"replace={replace_error}; fallback={fallback_error}"
            ) from fallback_error


def _replace_outputs_transactionally(outputs: dict[Path, str]) -> None:
    """Prepara todas las escrituras y las instala con rollback verificable."""
    temporary: dict[Path, Path] = {}
    backups: dict[Path, Path | None] = {}
    try:
        for target, text in outputs.items():
            descriptor, temp_name = tempfile.mkstemp(
                prefix=f".{target.name}.", suffix=".tmp", dir=target.parent, text=True
            )
            temp_path = Path(temp_name)
            temporary[target] = temp_path
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(text)
                stream.flush()
                os.fsync(stream.fileno())

        for target in outputs:
            backup = None
            if target.exists():
                backup = target.with_name(f".{target.name}.{uuid.uuid4().hex}.bak")
                os.replace(target, backup)
            backups[target] = backup
            os.replace(temporary[target], target)
            temporary.pop(target)
    except Exception as install_error:
        rollback_errors: list[str] = []
        for target in reversed(list(backups)):
            backup = backups[target]
            try:
                if backup is None:
                    target.unlink(missing_ok=True)
                elif backup.exists():
                    _restore_backup(backup, target)
                else:
                    raise RuntimeError(f"backup de rollback ausente para {target}")
            except Exception as rollback_error:
                rollback_errors.append(str(rollback_error))
        if rollback_errors:
            raise RuntimeError(
                f"falló la publicación ({install_error}) y el rollback quedó incompleto: "
                + " | ".join(rollback_errors)
            ) from install_error
        raise
    else:
        for backup in backups.values():
            if backup is not None:
                backup.unlink(missing_ok=True)
    finally:
        for temp_path in temporary.values():
            temp_path.unlink(missing_ok=True)


def write_outputs(result: ImportResult, outdir: Path) -> list[Path]:
    """Escribe los artefactos del paquete en outdir y devuelve los ficheros creados.

    Publicable -> versión inmutable + alias actual + catálogo + QA en outdir.
    Bloqueado  -> versión canónica no consumible + QA en outdir/blocked; nunca
    recibe alias ni entrada de catálogo.
    """
    written: list[Path] = []
    if result.state == PUBLICABLE and result.exam is not None:
        exam = result.exam
        validate_exam_package(exam)
        expected_qa = qa_from_exam(exam)
        if (
            exam["qa"]["state"] != result.state
            or result.blocked_reason is not None
            or result.qa != expected_qa
        ):
            raise CanonicalPackageError("resultado publicable y QA no coinciden con el paquete")
        serialized = json.dumps(exam, ensure_ascii=False, indent=2) + "\n"
        version_dir = outdir / exam["id"] / "versions"
        version_target = version_dir / f"{exam['version']['id']}.json"
        qa_text = qa_markdown(exam, result.qa)
        version_qa_target = version_dir / f"{exam['version']['id']}.qa.md"
        target = outdir / f"{exam['id']}.json"
        qa_target = outdir / f"{exam['id']}.qa.md"
        catalog_target = outdir / "catalog.json"

        # Preflight completo: los fallos previsibles se detectan antes de crear
        # versiones o modificar aliases/catálogo publicados.
        if outdir.exists() and not outdir.is_dir():
            raise RuntimeError(f"directorio de salida no válido: {outdir}")
        if version_dir.exists() and not version_dir.is_dir():
            raise RuntimeError(f"directorio de versiones no válido: {version_dir}")
        if version_target.exists() and version_target.read_text(encoding="utf-8") != serialized:
            raise RuntimeError(
                f"colisión de versión inmutable: {version_target} ya existe con otro contenido"
            )
        if version_qa_target.exists() and version_qa_target.read_text(encoding="utf-8") != qa_text:
            raise RuntimeError(
                f"colisión de QA inmutable: {version_qa_target} ya existe con otro contenido"
            )
        for current_target in (version_target, version_qa_target, target, qa_target, catalog_target):
            if current_target.exists() and not current_target.is_file():
                raise RuntimeError(f"destino publicado no válido: {current_target}")
        if catalog_target.exists():
            try:
                catalog = json.loads(catalog_target.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError) as error:
                raise RuntimeError(f"catálogo no legible: {catalog_target}: {error}") from error
            _validate_catalog(catalog, catalog_target, outdir)
        else:
            catalog = {"schemaVersion": "1.0", "exams": []}
        latest_path = version_target.relative_to(outdir).as_posix()
        entry = _catalog_entry_from_exam(exam, latest_path)
        catalog["exams"] = sorted(
            [item for item in catalog["exams"] if item.get("id") != exam["id"]] + [entry],
            key=lambda item: item["id"],
        )
        catalog_text = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"

        outdir.mkdir(parents=True, exist_ok=True)
        version_dir.mkdir(parents=True, exist_ok=True)
        outputs: dict[Path, str] = {}
        if not version_target.exists():
            outputs[version_target] = serialized
        written.append(version_target)
        if not version_qa_target.exists():
            outputs[version_qa_target] = qa_text
        written.append(version_qa_target)

        # Los aliases actuales solo cambian después de validar y preparar todas
        # las salidas, incluido el catálogo completo.
        outputs[target] = serialized
        written.append(target)
        outputs[qa_target] = qa_text
        written.append(qa_target)
        outputs[catalog_target] = catalog_text
        _replace_outputs_transactionally(outputs)
        written.append(catalog_target)
    else:
        if result.state != BLOCKED or result.exam is None or not result.blocked_reason:
            raise CanonicalPackageError("resultado bloqueado sin estado o motivo coherente")
        exam = result.exam
        validate_exam_package(exam)
        expected_qa = qa_from_exam(exam)
        if result.qa != expected_qa or exam["qa"]["blockedReason"] != result.blocked_reason:
            raise CanonicalPackageError("resultado bloqueado y QA no coinciden con el paquete")
        outdir.mkdir(parents=True, exist_ok=True)
        blocked_dir = outdir / "blocked"
        blocked_dir.mkdir(parents=True, exist_ok=True)
        version_dir = blocked_dir / exam["id"] / "versions"
        version_dir.mkdir(parents=True, exist_ok=True)
        serialized = json.dumps(exam, ensure_ascii=False, indent=2) + "\n"
        version_target = version_dir / f"{exam['version']['id']}.json"
        if version_target.exists() and version_target.read_text(encoding="utf-8") != serialized:
            raise RuntimeError(
                f"colisión de versión bloqueada inmutable: {version_target} ya existe con otro contenido"
            )
        stem = Path(result.qa["sourcePdf"]).stem
        qa_target = blocked_dir / f"{stem}.qa.md"
        outputs: dict[Path, str] = {qa_target: qa_markdown(exam, result.qa)}
        if not version_target.exists():
            outputs[version_target] = serialized
        _replace_outputs_transactionally(outputs)
        written.extend([version_target, qa_target])
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse a SAS exam PDF into a canonical package + QA")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path, help="directorio de salida (o ruta JSON si --json-only)")
    parser.add_argument("--json-only", action="store_true", help="escribir solo el JSON canónico")
    args = parser.parse_args()

    result = build_exam(args.pdf)
    if args.json_only:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(result.exam, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"Generated {args.output} [{result.state}]")
    else:
        written = write_outputs(result, args.output)
        for path in written:
            print(f"Generated {path}")
    if result.state == BLOCKED:
        print(f"BLOCKED: {result.blocked_reason}")
        raise SystemExit(2)


if __name__ == "__main__":
    main()
