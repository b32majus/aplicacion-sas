# Sequential implementation run v2 — Aplicación SAS

**STATUS:** ACTIVE / post-T07  
**OWNER:** Sil  
**PLAN:** GitHub Issues #5–#16, externally audited `READY`  
**CURRENT FRONTIER:** T07 PASS / PR #23 / FINAL_HEAD `5f88ba3642bf6473c18432adadb1c543a442044e`  
**NEXT:** T08 / Issue #12  
**MERGE AUTHORITY:** HUMAN ONLY  
**MODE:** one ticket at a time, fresh cognitive context, stacked PRs

## Objective

Complete the remaining audited tickets with the minimum workflow that preserves correctness, traceability and safe publication.

The run has already shown that ceremony can itself create defects and delays. Therefore:

```text
models reason
skills provide methods
KairOS protects execution/publication boundaries
Git + tests provide reality
Sil decides material product/merge questions
```

## 1. Current verified stack

```text
T01 → PR #17
T02 → PR #18
T03 → PR #19
T04 → PR #20
T05 → PR #21
T06 → PR #22
T07 → PR #23
```

Current parent for T08:

```text
ENTRY_HEAD: 5f88ba3642bf6473c18432adadb1c543a442044e
PARENT_BRANCH: work/overnight-t07
PARENT_PR: #23
T08_BRANCH: work/overnight-t08
T08_PR_BASE: work/overnight-t07
```

Before continuing, verify these facts against Git/GitHub/runtime. Do not infer them from conversation history alone.

## 2. Authority / progressive read order

Per ticket:

1. exact current GitHub Issue body;
2. repository `START_HERE.md`, `PROJECT.md`, `DECISIONS.md` as needed;
3. SPEC v2 / CONTEXT only for compatible detail;
4. relevant current code/runtime facts;
5. this runbook and `OVERNIGHT-OPENCODE-PROMPT.md`.

Do not preload old review transcripts or migration history unless a concrete ambiguity requires them.

The current Issue is the executable contract. A later explicit Issue amendment overrides older compatible planning prose.

## 3. No bootstrap/planning inside the train

Do not run `/init`, `grill-with-docs`, `wayfinder`, `to-spec` or `to-tickets` during T08–T12.

Those phases are already closed. If implementation reveals a genuinely new human/product decision, STOP rather than reopening planning autonomously.

## 4. Execution topology

Persistent Herdr/workshop/backend is allowed. Cognitive context is disposable.

Each ticket gets:

```text
fresh writer context
→ exact current ticket
→ exact ENTRY_HEAD
→ minimal required project context
```

Do not carry the full previous writer/reviewer conversation into the next ticket.

Fresh context is also an allowed recovery mechanism **inside one ticket** when the active session stops reducing uncertainty.

## 5. KairOS role for this train

For the remainder of this train, KairOS is a **safety shell**, not the cognitive reviewer.

Keep:

- exact repo/base/worktree identity;
- isolated work branch;
- lease/process safety;
- deterministic evidence/checkpoint facts;
- no direct product push to `main`;
- no force-push;
- no merge;
- controlled non-force publication.

Do not require the immature `kairos-reviewer`/result-sink path to provide review intelligence.

Harness/runtime failures are `HARNESS_RECOVERY`, not product defects and do not consume product repair authority.

## 6. Matt-native implementation/review semantics

Use Matt methods natively and deliberately:

- TDD when there is a concrete observable behavior with an agreed seam;
- implementation remains one vertical ticket;
- standalone `code-review` runs from a fresh context;
- one full review pass per ticket, not repeated review-until-clean.

Because `code-review` reads `<fixed-point>...HEAD`, the supported order is:

```text
implementation + deterministic gates
→ local checkpoint commit
→ ONE fresh standalone Matt code-review against ENTRY_HEAD
→ adjudication
→ bounded repair/fixup if required
→ focused closure
→ push/PR
```

The checkpoint commit is local until the ticket is accepted for publication.

## 7. Review adjudication contract

A reviewer finding is a hypothesis until adjudicated.

Every finding becomes exactly one of:

```text
VERIFIED_CURRENT_DEFECT
ROUTE_TO_FUTURE_TICKET
NOTE
NEEDS_EVIDENCE
```

Deduplicate the same defect reported independently by Standards and Spec.

### Current defect
Must materially violate current acceptance/spec, create a regression, expose security/data risk or create concrete inconsistency.

### Future-ticket route
Valid issue, wrong owner ticket. Record and continue current ticket.

### Note
Smell/refactor/style/test preference/future hardening. Does not block by default.

### Needs evidence
Plausible from source, not yet observable. Reproduce first.

A raw `MATERIAL` label is never sufficient by itself to consume a repair.

## 8. Reproduction before mutation

For timing, races, retries, network and concurrency:

```text
claim
→ focused controlled reproduction
→ observed behavior
→ adjudication
→ repair only if verified
```

Do not repair solely because code contains `await`, a timeout, multiple RPCs or a reviewer-proposed implementation.

Lessons already proven in this train:

- exactly-once domain effect does not imply exactly-one RPC;
- finalization can require exactly-once when the ticket says so;
- test elapsed-time deltas, not fragile absolute display values;
- known offline is not an uncertain server outcome;
- uncertain response retries reuse the exact logical envelope;
- definitive semantic rejection is not an uncertain response;
- do not increase timeout to hide a stuck state.

## 9. Bounded repair and closure

After adjudication, collect all `VERIFIED_CURRENT_DEFECT` findings into **one bounded repair set** when they belong to the same ticket/seam.

Then:

```text
focused RED
→ smallest causal fix
→ focused GREEN
→ affected regression
→ final deterministic gates
→ fresh focused closure
```

Do not run another full Matt review after the repair.

Closure checks only:

- accepted findings;
- repair delta;
- regressions caused by that delta.

If closure finds a repair-caused regression, use a `DELTA_REGRESSION_REPAIR` followed by focused closure.

If the same property repeatedly fails to converge, use fresh diagnosis rather than expanding scope.

## 10. Fresh diagnosis escape hatch

Trigger a fresh read-only diagnostic context when the current session shows churn such as:

- repeated timeout changes;
- temporary logging cycles without narrowing the failure;
- several speculative subsystem edits;
- same failure returning through different patches;
- context becoming dominated by old hypotheses.

Preserve the worktree. Ask the fresh diagnosis to return:

```text
FIRST_FAILING_BOUNDARY
ROOT_CAUSE
EVIDENCE
SMALLEST_FIX_SURFACE
PRODUCT_DEFECT | TEST_DEFECT | HARNESS_DEFECT
```

Do not mutate until the first failed predicate/await/boundary is identified.

## 11. Verification policy

For T08–T11 the primary contract is Seam 2: browser/PWA ↔ visible behavior + Supabase/persisted state.

T12 wraps Seam 1 from **canonical JSON onward**; it does not require a generic future PDF parser.

Default rhythm:

```text
baseline before mutation
→ focused inner-loop checks
→ affected regression
→ final gates
```

For the current app stack, a normal final Seam 2 gate is:

```text
npm test
npm run build
npm run test:e2e
```

Do not rerun full E2E after every micro-edit.

If a full-suite-only failure appears, reproduce focused before modifying product.

Avoid tests coupled to private helpers, exact internal RPC counts, incidental DOM structure or implementation-specific snapshot internals unless that detail is itself the contract.

## 12. Hosted Supabase authority

Authorized project:

```text
ogdguadpvplktkgawscm
```

Current known migration ledger after T07:

```text
20260810213000
```

Rules:

- hosted is the effective route for this project;
- verify-before-mutate;
- no local Docker requirement;
- never recreate valid auth/users/config by reflex;
- applied migrations are immutable;
- SQL/RPC change = new forward migration;
- verify remote ledger before push;
- browser publishable config is allowed;
- privileged credentials remain ignored/unversioned.

## 13. Process/port/runtime noise

Port collisions, stale Vite processes, dead leases, sandbox-denied process inspection and result-sink issues are supervisor/harness responsibilities.

Do not edit product code merely to route around one occupied port or control-plane limitation.

The supervisor may clean/reconcile only the exact harness process/state it can safely attribute; never `git clean` or delete foreign product work.

## 14. Size and ticket cohesion

Raw line/file count is not a blocking criterion.

A large candidate is acceptable when it is one causally coherent vertical and its migration/UI/persistence/tests are all required for one observable outcome.

Split only at an independent, preservable causal checkpoint. Do not split by frontend/backend/tests/file count.

A size exception never authorizes work from another ticket.

## 15. Remaining queue

```text
T08 #12 — Historial inmutable + exact version replay
T09 #13 — Dashboard/ranking without private-data leakage
T10 #14 — Examen artificial 75 preguntas
T11 #15 — PWA install/update/cache shell
T12 #16 — canonical JSON → QA → PR/human merge gate → catalog/deploy
```

Use the exact audited dependencies in the Issues. Continue sequentially for this train.

## 16. Per-ticket execution contract

For each remaining ticket:

1. verify prior FINAL_HEAD and parent PR;
2. fetch/read exact Issue;
3. create new branch/worktree from prior FINAL_HEAD;
4. run baseline before product mutation;
5. launch fresh writer;
6. implement only current vertical;
7. use focused/TDD checks;
8. run final deterministic gates;
9. create local checkpoint commit;
10. run ONE fresh standalone Matt review against ENTRY_HEAD;
11. reconcile + deduplicate + adjudicate findings;
12. reproduce `NEEDS_EVIDENCE` before mutation;
13. bounded repair if required;
14. focused closure only;
15. freeze exact final tree;
16. non-force push;
17. create stacked PR whose base is the previous work branch;
18. record evidence and start next ticket in a fresh context.

## 17. Stacked PR contract

Do not point child PRs directly to `main` while the train is stacked.

For each ticket record:

```text
ENTRY_HEAD
FINAL_HEAD
HEAD_BRANCH
PARENT_BRANCH
PARENT_PR
PR
```

After the train, human merge sequence is:

```text
merge parent to main
→ verify main contains parent FINAL_HEAD
→ retarget immediate child to main
→ verify child-only diff/checks
→ merge child
→ repeat
```

No force-push or history rewrite to make the stack prettier.

## 18. Model policy for this run only

For the remainder of this current train:

```text
GPT-5.6 Sol Fast
reasoning HIGH
```

This is a temporary run override, not future KairOS policy.

Fast is an optimization, not a gate. Do not mutate global OpenCode/KairOS configuration merely to obtain it.

## 19. Control-plane mutation boundary

Do not modify prompt/runbook/model policy on product `main` while a product candidate is active.

Record new lessons externally and consolidate only at a safe ticket frontier such as PASS+PR before the next writer starts.

## 20. CI expectation

The repository currently may report no configured PR checks. Until T12, that absence is not a product blocker when required local/hosted gates are green.

Do not expand T08–T11 to create CI infrastructure merely because GitHub shows no checks.

## 21. Hard STOP conditions

STOP the train only for a material boundary:

- unrecoverable/ambiguous Git identity;
- genuine human/product decision;
- current acceptance still failing after focused diagnosis/repair and not converging;
- semantic integration conflict;
- security/sensitive-data exposure;
- required external state unavailable or unauthorized;
- unsafe/unknown publication outcome;
- action would require merge, force-push, product direct-main push, deploy or credential/global-config mutation.

Do **not** STOP solely for:

- reviewer NOTE;
- future-ticket finding;
- unadjudicated MATERIAL label;
- KairOS reviewer runtime unavailable;
- occupied E2E port;
- no configured CI;
- raw diff size.

Never skip a genuinely blocked ticket and continue to dependent descendants.

## 22. Explicitly forbidden

- merge or auto-merge;
- writer direct push to `main`;
- force-push/rebase published stack history;
- deploy/release/production activation;
- install/update skills during the train;
- mutate auth/SSH/MCP/plugins/global OpenCode config;
- re-open closed planning by preference;
- absorb future-ticket work because review mentioned it;
- build generic offline-first/Realtime/synchronization machinery without ticket authority;
- full-review loops until clean;
- one growing writer conversation for multiple tickets.

## 23. Closure report

For each attempted ticket record:

```text
TICKET / ISSUE
STATUS: PASS | BLOCKED | NOT_STARTED
ENTRY_HEAD
FINAL_HEAD
BRANCH
PARENT_BRANCH / PARENT_PR
PR
BASELINE
FOCUSED TESTS
NPM_TEST
BUILD
E2E
MIGRATION_LEDGER if applicable
FULL_REVIEW: once | not justified
FINDINGS: verified / routed / notes / needs_evidence
REPAIRS / FOCUSED_CLOSURE
HARNESS_RECOVERIES
STOP_REASON
```

Global invariants:

```text
MERGES: 0
DIRECT_MAIN_PRODUCT_PUSHES: 0
FORCE_PUSHES: 0
DEPLOYS: 0
```

## Done

The remaining train is successful when T08–T12 each reach a verified stacked PR or the train stops at the first genuinely material boundary, without making Sil supervise predictable machinery and without converting reviewer/harness noise into product scope.
