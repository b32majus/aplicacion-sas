# Overnight sequential implementation run — Aplicación SAS

**STATUS:** READY  
**OWNER:** Sil  
**PLAN:** GitHub Issues #5–#16, externally audited `READY`  
**MERGE AUTHORITY:** HUMAN ONLY  
**MODE:** unattended, one ticket at a time, fresh OpenCode context per ticket

## Objective

Use the approved ticket graph to make as much correct/verifiable progress as possible overnight without requiring Sil to supervise predictable transitions.

This is deliberately **sequential** even where the audited DAG exposes a wider frontier. The overnight train values deterministic integration and easy morning review over parallel throughput.

## Authority / read order

Before doing anything:

1. repository `START_HERE.md`
2. `PROJECT.md`
3. `DECISIONS.md`
4. `docs/workflow/README.md`
5. `docs/workflow/aplicacion-sas-SPEC-to-spec-v2.md`
6. `docs/workflow/aplicacion-sas-CONTEXT-final.md`
7. `docs/workflow/AUDIT-TICKETS-RESULT.md`
8. `docs/workflow/OVERNIGHT-QUEUE.json`
9. current GitHub Issue body only

Earlier specs/architectures and the brownfield prototype are evidence/history, not authority when they conflict with SPEC v2.

## Mandatory preflight

Before T01:

- verify the current working directory is the real `b32majus/aplicacion-sas` checkout and the expected remote resolves to that repository;
- fetch `origin/main` and record the exact starting SHA;
- do not start from a dirty/ambiguous worktree;
- verify the 12 filenames listed in `INITIAL-PDF-FIXTURES.md` exist somewhere accessible to the T01 worktree/runtime;
- verify the KairOS/OpenCode runtime can launch a fresh native writer session and read the project repo;
- locate the **installed local copies** of Matt Pocock `tdd`, `implement` and `code-review`; read them before execution, but do not install/update skills during the train;
- if repository `AGENTS.md` is absent, create/improve it using native OpenCode `/init` as the technical repository bootstrap before starting T01; `/init` must not invent product decisions or replace SPEC v2;
- do not repurpose an unrelated hosted Supabase project. Local/isolated Supabase is acceptable for implementation/tests. If a live hosted project becomes genuinely mandatory to prove an acceptance criterion, STOP with `SUPABASE_PROJECT_REQUIRED` rather than borrowing another project.

If any mandatory fixture, identity or safe execution prerequisite is missing, STOP with a concise report. Do not improvise around it.

## Matt skills + KairOS review policy

Matt skills are **methods**, while KairOS remains the BUILD_READY→PR execution/certification authority.

- Planning skills are closed for this run: do not invoke `grill-with-docs`, `wayfinder`, `to-spec` or `to-tickets`.
- Use `/tdd` where it improves signal. The testing seams are already approved by SPEC/tickets, so no new human confirmation is required:
  - T01 → Seam 1, PDF oficial → paquete canónico + QA.
  - T02–T11 → Seam 2, navegador/PWA → comportamiento visible + estado/Supabase.
  - T12 → wrapper operativo de Seam 1, incluido gate PR/humano.
- Current upstream `/implement` invokes `/code-review` at the end. KairOS already owns the single fresh tree-bound reviewer for the candidate and the KairOS workflow explicitly avoids duplicate reviewers. Therefore **do not invoke `/implement` as a top-level command if the installed local copy also launches an independent `/code-review`**.
- In that case, implement the ticket directly inside the fresh KairOS writer using the same vertical/TDD discipline, and let the KairOS reviewer be the sole routine code reviewer.
- If the installed `/implement` has been locally adapted so its final review delegates exclusively to KairOS and does not create another reviewer, it may be used.
- If KairOS review is required but cannot execute, STOP with `REVIEW_RUNTIME_UNAVAILABLE`; do not silently substitute another review path.

## Why the supervisor should use dynamic ONCE checkpoints

The approved tickets are causally dependent. A later ticket must build on the exact successful head of its predecessors, and that future SHA does not exist before the previous ticket finishes.

Therefore the persistent Herdr/OpenCode workshop should act only as a thin **supervisor** and materialize each next KairOS Work Order after the previous checkpoint is known. For each ticket, invoke the normal KairOS execute path in **ONCE** mode with a fresh native writer session; after PASS, use that exact published/checkpoint head as the next ticket base.

Do **not** implement T01–T12 inside one ever-growing cognitive OpenCode conversation. Persistent Herdr workspace/backend is fine; persistent ticket reasoning context is not.

A static `--mode sequential` list is appropriate only if all manifest bases can be established safely in advance. For this dependent train, dynamic ONCE chaining is the safer default.

## Approved linear order

```text
T01 #5
 ↓
T02 #6
 ↓
T03 #7
 ↓
T04 #8
 ↓
T05 #9
 ↓
T06 #10
 ↓
T07 #11
 ↓
T08 #12
 ↓
T09 #13
 ↓
T10 #14
 ↓
T11 #15
 ↓
T12 #16
```

This is a valid topological order of the audited DAG. T12 could legally start after T02, but remains last overnight to avoid changing import/deploy automation while the application stack is still being built.

## Per-ticket execution contract

For each queue item:

1. **Check prerequisite checkpoint**  
   Every declared blocker must already be present in the current integration head as a verified successful checkpoint. GitHub Issue closure is not required overnight if code is stacked and unmerged; exact successful Git head/evidence is the authority.

2. **Compile one bounded BUILD_READY WO**  
   Use the exact current Issue body plus SPEC v2/CONTEXT only as needed. Do not add scope or reinterpret acceptance. Set `HUMAN_DECISIONS_OPEN: NONE` unless implementation uncovers a genuinely new human/product decision, in which case STOP.

3. **Create a new branch/worktree from the prior successful FINAL_HEAD**  
   Never rewrite or rebase an already certified checkpoint merely to absorb later work.

4. **Launch a fresh OpenCode writer context**  
   Implement exactly one tracer bullet. Use `/tdd` against the approved seam where useful, run regular focused checks, then finish with proportional acceptance/truth + affected regression. Do not invoke closed planning skills.

5. **Respect brownfield policy**  
   Reuse existing code only when it simplifies compliance with the current ticket/SPEC. Do not preserve legacy abstractions by sunk cost; do not rewrite useful infrastructure for aesthetics.

6. **Review**  
   Ordinary non-trivial code gets the fresh read-only review required by current KairOS policy. Reviewer sees the current acceptance, exact candidate and incremental diff, not the writer transcript or entire overnight history. Do not add Matt `/code-review` as a second routine reviewer.

7. **Checkpoint/publication**  
   Only after required deterministic checks and review PASS: create the exact checkpoint commit, non-force push the work branch and open/update a PR to `main`. Do not merge.

8. **Advance**  
   Record FINAL_HEAD, PR, tests/QA/review result and use FINAL_HEAD as the base for the next ticket. Then discard the prior cognitive session and launch a fresh one.

## Integration-base rule

Before starting each next ticket:

- fetch `origin/main`;
- record `PREVIOUS_SUCCESSFUL_FINAL_HEAD` and current `origin/main`;
- if main advanced independently, preserve the prior checkpoint and create the smallest non-rewriting integration base containing both when Git can do so unambiguously;
- if integration requires a semantic choice or produces an ambiguous conflict, STOP. No silent semantic resolution, rebase or force-push.

## Verification policy

Follow the ticket's declared Seam 1 / Seam 2 contract and KairOS minimum-sufficient verification:

```text
inner loop → cheapest focused evidence
stable candidate → ticket acceptance/truth + affected regression
broaden → only when blast radius/risk/failure signal justifies it
```

Do not replace high-level seam tests with a proliferation of private-helper unit tests. Do not claim PASS for a criterion that could not actually be demonstrated.

## Model preset guidance

`OVERNIGHT-QUEUE.json` contains a recommended preset per ticket:

- `hybrid` for bounded ordinary implementation where throughput matters;
- `critical` for auth/RLS, shared persistence, deadlines, sync/conflict, aggregate security and publication automation.

These are execution recommendations, not product decisions. If the effective runtime proves a listed preset unavailable, use the smallest already-qualified equivalent or STOP rather than changing provider/model architecture during the train.

## Hard STOP conditions

STOP the full train at the first real boundary:

- missing one of the 12 mandatory PDF fixtures for T01;
- mandatory acceptance/truth/affected test still failing after bounded repair;
- reviewer returns a concrete material `BLOCKED` finding that cannot be repaired within the budget;
- KairOS reviewer required but unavailable;
- new product/architecture/human-authority decision is genuinely required;
- wrong/ambiguous repository, worktree, branch or remote identity;
- semantic integration conflict;
- unsafe/unknown remote publication outcome;
- secret or real sensitive data exposure;
- an acceptance criterion requires an unavailable external operational input and cannot honestly be proven in the isolated test environment;
- fresh per-ticket execution identity cannot be established safely;
- any requested action would require auto-merge, direct `main` push, force-push, deploy/production activation, credential mutation or unrelated global configuration changes.

Do not skip a blocked ticket and continue to descendants that rely on it.

## Explicitly forbidden overnight

- merge or auto-merge any PR;
- push directly to `main`;
- force-push/rebase published checkpoint history;
- deploy/release/production activation;
- create or reuse a hosted Supabase project without explicit Sil decision;
- modify unrelated credentials/auth/SSH/MCP/plugins/global OpenCode config;
- install/update skills;
- publish real sensitive data;
- broaden product scope;
- reopen approved planning;
- duplicate Matt + KairOS reviewers on the same candidate by routine;
- use one growing writer conversation for all tickets;
- parallelise product-code tickets during this unattended train.

## Morning report

On COMPLETE or STOP, leave a concise report containing, for each attempted ticket:

```text
TICKET / ISSUE
STATUS: PASS | BLOCKED | NOT_STARTED
ENTRY_HEAD
FINAL_HEAD
BRANCH
PR
FOCUSED/SEAM TESTS
AFFECTED REGRESSION
REVIEW
REPAIR_COUNT
NOTES / BLOCKER
```

Then summarize:

```text
LAST_SUCCESSFUL_TICKET
LAST_SUCCESSFUL_FINAL_HEAD
STOP_REASON (if any)
HUMAN_DECISIONS_OPEN
PRS_OPEN
MERGES: 0
DIRECT_MAIN_PUSHES: 0
FORCE_PUSHES: 0
DEPLOYS: 0
NEXT_SAFE_ACTION
```
