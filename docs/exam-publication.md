# Publish a canonical exam through human review

Publication starts from a manually prepared or assisted canonical JSON package
plus a public official-source sidecar. Automatic PDF parsing is not a production
requirement or publication gate. Automation begins with canonical JSON
validation and prepares a proposal PR; merging that PR is the publication
decision. The existing Pages workflow remains the only frontend deploy.

## Quick Path

1. Add `<exam-id>.json` and `<exam-id>.source.json` under `exam-inputs/` in a reviewed change to `main`.
2. Let `Prepare exam publication proposal` validate the pair and open one deterministic proposal PR.
3. Review the immutable package, versioned QA report, alias, catalog and matching `supabase/official-exam-registrations/<exam-id>/<version>.sql` diff in that PR.
4. Merge to approve, or close without merging to reject. A merge to `main` triggers the existing `pages.yml` workflow.
5. After merge, an administrator applies the reviewed registration SQL through the approved Supabase administrative channel. The publication workflow has no production database credential and never applies it automatically.

Use the workflow dispatch input only to rerun an input already on `main`. It
accepts the canonical exam id, not an arbitrary path.

## Gates

| Stage | Guarantee |
|---|---|
| Input | Sidecar hash matches canonical `source.sha256`; reference is public, credential-free HTTPS without secret-bearing path segments. |
| Validation | Calls T01 `validate_exam_package`; blocked or invalid input exits with `BLOCKED:` diagnostics before bank writes. |
| Proposal | Calls T01 `write_outputs`, preserving old immutable versions and preparing QA, alias and catalog together. |
| Registry | Generates an idempotent SQL registration for the exact exam id, version path, duration, active question identities and server-side answer key. |
| PR check | Revalidates input pairs, every recognized public artifact, exact QA rendering, aliases, catalog and deterministic registry SQL; existing versions and registrations cannot change or disappear. |
| Approval | Validation alone does not publish. Only human merge changes `main`. |
| Deploy | `pages.yml` builds and deploys merged `main`; proposal automation never deploys. |

At runtime the authenticated application intersects the static catalog with the
metadata-only published registry RPC. Static-first and registry-first deployment
orders both fail closed: a version is available only when `exam_id`, `version_id`
and `version_path` agree. The RPC does not expose answer keys, and direct table
access remains revoked.

Server-authoritative answer key means authoritative persisted scoring is
server-side; official answer-key confidentiality is not a product requirement.
Public canonical study packages retain `correctOption` for immediate correction
and exact historical replay.

The proposal review body shows exam identity, official reference and source
hash, immutable version, duration, active/annulled/reserve counts and QA
incidents. The source sidecar is not copied into `app/public` or the bundle.

## Failure Handling

- Fix an invalid or blocked canonical package outside the publication bank, then commit a new valid input.
- A correction changes canonical content, therefore receives a new immutable version while old paths remain present.
- An unchanged input produces no bank diff and no PR.
- Any existing deterministic proposal, including a closed or merged PR whose branch was deleted, is treated as the recorded human decision and is never recreated automatically.
- If GitHub Actions cannot open PRs, enable repository setting **Allow GitHub Actions to create and approve pull requests**. No PAT or Supabase secret is required.

## Safe Local Demonstration

The focused test uses the existing T01 canonical 2021 package plus
`tests/fixtures/publication/sas-administrativo-2021-turno-libre.source.json`.
It prepares a corrected proposal in a temporary bank, proves the source catalog
is byte-for-byte unchanged, confirms the old version remains addressable, and
then validates the simulated post-merge bank.

```bash
.venv/bin/python -m unittest -v tests/test_exam_publication.py
python scripts/publish_exam.py verify-bank
```

Automatic/general PDF parsing and an administrative approval UI are intentionally
outside the supported future publication workflow. Existing parser tooling remains
available for the initial bank and reproducibility only.
