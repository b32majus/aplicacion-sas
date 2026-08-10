# OpenAI Sol Fast override — Aplicación SAS

**STATUS:** ACTIVE FOR CURRENT UNATTENDED TRAIN  
**SCOPE:** execution/model policy only; does not change product scope, tickets, acceptance or KairOS safety gates.

## Decision

For every remaining product-code Work Order, prefer the KairOS `critical` preset so the writer uses `openai/gpt-5.6-sol`.

Use Fast/Priority serving for Sol whenever the effective OpenCode runtime can enable it **without persistent global configuration mutation**. Fast is a throughput optimization, not a correctness gate: inability to prove/use Fast must not block a WO that can safely run with ordinary `critical` Sol.

The KairOS reviewer policy remains unchanged. Do not replace the configured independent reviewer merely to make every model OpenAI.

## Reasoning effort

Use the queue field `writer_reasoning`:

- `high`: T01, T02, T04, T05, T08, T10, T11.
- `xhigh`: T03, T06, T07, T09, T12.

`xhigh` is reserved for the slices with the densest persistence/concurrency/security/deadline/publication reasoning. Do not automatically escalate every ticket beyond the queue value.

## Effective-runtime procedure

Before launching the next fresh writer:

1. Verify the installed OpenCode runtime exposes `openai/gpt-5.6-sol` and the requested reasoning variant.
2. Verify whether Fast/Priority service tier is available through the actual OpenAI/ChatGPT connection used by OpenCode.
3. Prefer an ephemeral/runtime-only mechanism. OpenCode supports per-run model variants and runtime config overrides; do not edit the user's persistent global OpenCode config merely to enable Fast.
4. If a runtime-only Fast configuration can be proven effective, use it together with the queue reasoning effort.
5. If Fast is unavailable, unsupported by this connection, or cannot be verified safely, continue using `critical` Sol at standard service tier and record `FAST_EFFECTIVE: NO` in the WO report. Do not STOP solely for that.
6. Never change model/provider architecture, credentials, auth, MCPs, plugins or KairOS lifecycle semantics to obtain Fast.

## Recovery T01

The preserved T01 candidate does not need another writer if certification/review passes unchanged. If a material reviewer finding requires a repair writer, use `critical` + Sol + `high` reasoning and prefer Fast under the same rules above.

## Reporting

For each WO add:

```text
WRITER_MODEL
WRITER_REASONING
FAST_REQUESTED: YES
FAST_EFFECTIVE: YES | NO | UNKNOWN
```

Do not claim Fast was effective merely because it was requested; use whatever effective runtime metadata OpenCode exposes.
