# DECISIONS — Aplicación SAS

Record only durable decisions that change future work. Detailed debate remains in workflow artifacts, Issues and PRs.

## D-001 — SPEC v2 and CONTEXT are authoritative

```text
DATE: 2026-08-10
STATUS: ACTIVE
ADR: none
```

### Decision
`docs/workflow/aplicacion-sas-SPEC-to-spec-v2.md` is the current functional/technical contract and `docs/workflow/aplicacion-sas-CONTEXT-final.md` is the canonical glossary. Earlier specs/architectures are traceability only when they conflict.

### Why
SPEC v2 passed independent re-review and was declared ready for ticketing.

### Consequences
- Future agents do not reopen settled product decisions without new material evidence.
- Legacy README/architecture/code cannot override SPEC v2.

### Revisit when
- New evidence makes a SPEC v2 decision materially impossible or unsafe.

---

## D-002 — Brownfield salvage, not preservation by inertia

```text
DATE: 2026-08-10
STATUS: ACTIVE
ADR: none
```

### Decision
Keep the repository/history and reuse useful pieces such as parser principles, QA fixture, Pages deploy, CSS/markup and small helpers. Replace legacy core/schema/controller pieces when preserving them would distort SPEC v2.

### Why
The prototype predates the final workflow and contains both useful evidence and superseded assumptions.

### Consequences
- No greenfield rewrite by default.
- No compatibility layer solely to preserve experimental abstractions.

### Revisit when
- Implementation evidence shows a supposedly replaceable component is already aligned and cheaper to adapt.

---

## D-003 — T01–T12 plan is externally audited READY

```text
DATE: 2026-08-10
STATUS: ACTIVE
ADR: none
```

### Decision
GitHub Issues #5–#16 are the approved tracer-bullet implementation graph. The external ticket audit returned `READY`; result is archived in `docs/workflow/AUDIT-TICKETS-RESULT.md`.

### Why
The auditor checked coverage, dependencies, privacy, deadlines, versioning, idempotency, seams and excluded scope against SPEC v2/CONTEXT.

### Consequences
- Do not regenerate planning from scratch.
- Correct tickets only if implementation reveals a material contradiction.

### Revisit when
- A ticket reaches a real blocker proving the approved plan cannot satisfy the contract.

---

## D-004 — Overnight execution is sequential, fresh-context and fail-closed

```text
DATE: 2026-08-10
STATUS: ACTIVE
ADR: none
```

### Decision
For unattended work, linearize the approved DAG in ticket order T01→T12. Use a persistent Herdr workshop/backend only as supervisor; each ticket gets a fresh OpenCode writer/reviewer context. Advance only after a verified PASS/checkpoint; any material BLOCKED condition stops the train. No auto-merge.

### Why
This sacrifices parallel throughput overnight in exchange for minimal branch races, deterministic dependency availability and easy morning review.

### Consequences
- Later tickets may inherit earlier already-passed sibling changes even when not strict blockers; this is intentional for the unattended linear train.
- PRs may be stacked/cumulative; incremental review range remains previous successful head → current candidate.
- T12 stays last overnight even though its graph blockers would allow it after T02.

### Revisit when
- Sil is present and wants to exploit the true frontier in parallel.
