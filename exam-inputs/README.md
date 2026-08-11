# Canonical exam publication inputs

This directory starts the publication automation at a completed T01 canonical
package. It is not a PDF upload area and does not run a generic PDF parser.

For `<exam-id>`, add both files in a normal reviewed change to `main`:

- `<exam-id>.json`: canonical package accepted by `validate_exam_package`.
- `<exam-id>.source.json`: public official-source reference and matching hash.

```json
{
  "schemaVersion": "1.0",
  "examId": "sas-administrativo-2026-turno-libre",
  "officialSource": {
    "reference": "https://official.example/exams/2026",
    "sha256": "64-lowercase-hex-characters-matching-source.sha256"
  }
}
```

Do not include PDFs, credentials, signed URLs, tokens, private URLs, or personal
data. The reference must use HTTPS without credentials, query parameters, or a
fragment. The sidecar remains review metadata and is not copied into the public
bundle.
