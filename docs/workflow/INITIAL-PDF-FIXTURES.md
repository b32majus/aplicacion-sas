# Initial PDF fixtures — Aplicación SAS

T01 / Seam 1 must run against these 12 real SAS PDFs. The implementation workspace must have all 12 available before the unattended train starts.

```text
Examen_ADM_PI_2015.pdf
Examen_ADM_PI_2018.pdf
Examen_ADM_PI_2021.pdf
Examen_ADM_PI_2025.pdf
Examen_ADM_L_2015.pdf
Examen_ADM_L_2018.pdf
Examen_ADM_L_2021.pdf
Examen_ADM_L_2023.pdf
Examen_ADM_L_2025.pdf
Examen_ADM_PI_AP_2021.pdf
Examen_ADM_L_AP_2021.pdf
Examen_ADM_L_APL_2015.pdf
```

## Preflight rule

- Search the actual VPS project/workspace for these exact fixtures before T01.
- If any are missing, report `FIXTURES_MISSING` with the missing filenames and STOP before implementation; do not substitute another PDF.
- Do not automatically publish/copy the PDFs into the public GitHub repository merely to satisfy the train. Local test fixtures may remain local until repository/distribution handling is intentionally exercised by T12.
- The 2023 PDF is the known pilot fixture and must continue to surface the QA anomaly around question 35 without silently correcting the source.
