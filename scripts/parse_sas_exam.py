#!/usr/bin/env python3
"""Convert a text-based SAS exam PDF into canonical JSON plus a QA report.

The official answer key remains authoritative. The parser never invents or
corrects question content; suspicious source fragments are reported for review.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF

QUESTION_LINE_RE = re.compile(r"^\s*(\d{1,4})\s*$")
OPTION_RE = re.compile(r"^\s*([A-F])\)\s*(.*)$")
ANSWER_RE = re.compile(r"^(?:[A-F]|ANULADA)$", re.IGNORECASE)
PAGE_HEADER_RE = re.compile(r"^Página\s+\d+\s+de\s+\d+$", re.IGNORECASE)
HEADER_META_RE = re.compile(
    r"SAS_(?P<category>.+?)\s+(?P<year>20\d{2})\s*/\s*(?P<access>[^\n]+)",
    re.IGNORECASE | re.DOTALL,
)

HEADER_LINES = {"CUESTIONARIO", "TEÓRICO", "PRÁCTICO", "TEÓRICO/PRÁCTICO", "RESERVA"}


@dataclass
class Segment:
    number: int
    source_page: int
    is_reserve: bool
    lines: list[str]


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
    if compact.startswith("SAS_") or compact.startswith("TURNO "):
        return True
    return False


def find_answer_page(doc: fitz.Document) -> int:
    for index in range(len(doc) - 1, -1, -1):
        if "Plantilla de Respuestas" in doc[index].get_text("text"):
            return index
    raise ValueError("No official answer-key page was found")


def detect_metadata(doc: fitz.Document, answer_page_index: int) -> tuple[str, str, int, str]:
    sample = "\n".join(doc[i].get_text("text") for i in range(min(answer_page_index, 5)))
    match = HEADER_META_RE.search(sample)
    if not match:
        # Fallback to the answer-key title, which is generally one line.
        answer_text = doc[answer_page_index].get_text("text")
        fallback = re.search(r"SAS_(.+?)\s+(20\d{2})\s*-\s*([^\n]+)", answer_text, re.I)
        if not fallback:
            raise ValueError("Could not infer category, year and access type from PDF headers")
        category, year, access = fallback.group(1), int(fallback.group(2)), fallback.group(3)
    else:
        category = normalize_text(match.group("category"))
        year = int(match.group("year"))
        access = normalize_text(match.group("access"))

    category_label = category.replace("_", " ").strip()
    access_label = access.replace("_", " ").strip()
    exam_id = f"sas-{slugify(category_label)}-{year}-{slugify(access_label)}"
    title = f"SAS {category_label.title()} {year} - {access_label.title()}"
    return exam_id, title, year, category_label.title()


def extract_question_segments(doc: fitz.Document, answer_page_index: int) -> list[Segment]:
    segments: list[Segment] = []
    current: Segment | None = None

    for page_index in range(answer_page_index):
        raw_text = doc[page_index].get_text("text")
        # Skip covers, blank pages and instructions lacking a complete option set.
        if not all(f"{letter})" in raw_text for letter in "ABCD"):
            continue
        page_is_reserve = "CUESTIONARIO" in raw_text and "RESERVA" in raw_text
        lines = [line.strip() for line in raw_text.splitlines() if not is_header_line(line)]

        for line in lines:
            match = QUESTION_LINE_RE.match(line)
            if match:
                number = int(match.group(1))
                if 1 <= number <= 999:
                    if current is not None:
                        segments.append(current)
                    current = Segment(number, page_index + 1, page_is_reserve, [])
                    continue
            if current is not None:
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
    if not question_text:
        raise ValueError(f"Question {segment.number}: empty text")
    if [option["id"] for option in options] != ["A", "B", "C", "D"]:
        raise ValueError(
            f"Question {segment.number}: expected options A-D, found {[option['id'] for option in options]}"
        )

    return {
        "id": f"{exam_id}-q{segment.number:03d}",
        "number": segment.number,
        "text": question_text,
        "options": options,
        "correctOption": None,
        "status": "reserve" if segment.is_reserve else "valid",
        "topic": None,
        "sourcePage": segment.source_page,
    }


def extract_answers(doc: fitz.Document, answer_page_index: int) -> dict[int, str | None]:
    lines = [normalize_text(x) for x in doc[answer_page_index].get_text("text").splitlines()]
    ignored = {"Orden", "examen", "Respuesta", "correcta", "Plantilla de Respuestas DEFINITIVA"}
    tokens = [x for x in lines if x and x not in ignored and not x.startswith("SAS_")]

    answers: dict[int, str | None] = {}
    i = 0
    while i < len(tokens) - 1:
        if tokens[i].isdigit() and ANSWER_RE.match(tokens[i + 1]):
            number = int(tokens[i])
            value = tokens[i + 1].upper()
            answers[number] = None if value == "ANULADA" else value
            i += 2
        else:
            i += 1
    if not answers:
        raise ValueError("No official answers were extracted")
    return answers


def source_flags(question: dict[str, Any]) -> list[str]:
    flags: list[str] = []
    for option in question["options"]:
        # A very short lowercase fragment after a completed sentence is often a PDF/source typo.
        match = re.search(r"[.!?]\s+([a-záéíóúñü]{3,25}[.!?])$", option["text"])
        if match and len(match.group(1)) <= 25:
            flags.append(f"option_{option['id']}_suspicious_trailing_fragment:{match.group(1)}")
    return flags


def build_exam(pdf_path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    doc = fitz.open(pdf_path)
    answer_page_index = find_answer_page(doc)
    exam_id, title, year, category = detect_metadata(doc, answer_page_index)
    answers = extract_answers(doc, answer_page_index)
    answer_numbers = list(answers)

    parsed = [parse_question(segment, exam_id) for segment in extract_question_segments(doc, answer_page_index)]
    parsed_by_number = {question["number"]: question for question in parsed}
    missing_questions = [number for number in answer_numbers if number not in parsed_by_number]
    extra_questions = sorted(set(parsed_by_number) - set(answer_numbers))
    if missing_questions or extra_questions:
        raise ValueError(f"Question/answer mismatch. Missing={missing_questions}; extra={extra_questions}")

    questions = [parsed_by_number[number] for number in answer_numbers]
    flags: list[dict[str, Any]] = []
    for question in questions:
        answer = answers[question["number"]]
        if answer is None:
            question["correctOption"] = None
            question["status"] = "annulled"
        else:
            question["correctOption"] = answer
        for flag in source_flags(question):
            flags.append({"question": question["number"], "flag": flag, "sourcePage": question["sourcePage"]})

    sha256 = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    exam = {
        "schemaVersion": "1.0",
        "id": exam_id,
        "title": title,
        "category": category,
        "year": year,
        "source": {"questionPdf": pdf_path.name, "answersPdf": None, "sha256": sha256},
        "questions": questions,
    }

    status_counts = Counter(q["status"] for q in questions)
    qa = {
        "examId": exam_id,
        "sourcePdf": pdf_path.name,
        "sourceSha256": sha256,
        "answerKeyPage": answer_page_index + 1,
        "questionCount": len(questions),
        "statusCounts": dict(status_counts),
        "optionCountValid": all(len(q["options"]) == 4 for q in questions),
        "answerCoverageValid": all(q["status"] == "annulled" or q["correctOption"] in "ABCD" for q in questions),
        "flags": flags,
    }
    return exam, qa


def qa_markdown(qa: dict[str, Any]) -> str:
    lines = [
        f"# Informe de importación - {qa['examId']}",
        "",
        f"- PDF: `{qa['sourcePdf']}`",
        f"- SHA-256: `{qa['sourceSha256']}`",
        f"- Página de plantilla oficial: {qa['answerKeyPage']}",
        f"- Preguntas importadas: {qa['questionCount']}",
        f"- Estados: `{json.dumps(qa['statusCounts'], ensure_ascii=False)}`",
        f"- Cuatro opciones por pregunta: {'sí' if qa['optionCountValid'] else 'no'}",
        f"- Cobertura de respuestas oficiales: {'sí' if qa['answerCoverageValid'] else 'no'}",
        "",
        "## Incidencias para revisión humana",
        "",
    ]
    if not qa["flags"]:
        lines.append("No se detectaron incidencias heurísticas.")
    else:
        for flag in qa["flags"]:
            lines.append(f"- Pregunta {flag['question']} (página PDF {flag['sourcePage']}): `{flag['flag']}`")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse a SAS exam PDF into canonical JSON")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--qa-output", type=Path)
    args = parser.parse_args()

    exam, qa = build_exam(args.pdf)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(exam, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    qa_output = args.qa_output or args.output.with_suffix(".qa.md")
    qa_output.write_text(qa_markdown(qa), encoding="utf-8")
    print(f"Generated {args.output} with {len(exam['questions'])} questions")
    print(f"Generated QA report {qa_output} with {len(qa['flags'])} flag(s)")


if __name__ == "__main__":
    main()
