# Durable YuE2 admission refusal

## Reproduced integration defect

The worker client already distinguished an exact `HTTP 400` response containing
the expected worker contract, `state: refused`, and `error: invalid_job` from an
ambiguous transport failure. The durable adapter nevertheless attempted execution
accounting recovery after that refusal. Because this job was not queued, the
integration test received `execution_accounting_unavailable` instead of the
verified `worker_rejected_invalid_job` reason.

This affected the real shared music caller, not only the standalone operator CLI.
It obscured an actionable input problem and caused unnecessary worker reads.

## Repair

- The existing terminal `provenance.json` slot can now retain an immutable
  `studio-yue2-admission-refusal/v1` receipt bound to the exact binding hash and
  job ID. Successful completion keeps its existing provenance contract.
- Only the client's strictly verified pre-queue rejection creates this receipt.
  Malformed or foreign HTTP 400 responses do not acquire refusal authority.
- Recovery validates the complete receipt bytes, submission marker, and absence
  of contradictory candidate/accounting evidence before returning the same
  nonretryable refusal. This works without contacting the worker after restart.
- The existing submission marker is never deleted. Neither failed receipt
  persistence nor an ambiguous response allows a second submission, fallback
  provider, changed score, or new seed.
- The shared music module reports explicit input review rather than a generic
  missing-accounting problem. Its engine reconciliation fence remains active;
  normal resume does not repurchase the rejected stage.
- No execution allocation or provider invoice is fabricated. A pre-queue refusal
  does not establish that the rented VM or other provider activity cost nothing.

The existing provenance read carries this additional terminal state, so normal
pending/completed recovery does not gain another storage request. In the refusal
fixture, the initial POST is the final worker request and all subsequent recovery
is storage-only. No fleet billing reduction is claimed.

## Verification scope

The supervised durable regression failed before the fix with the masked error.
It now checks exact refusal retention, fresh-process offline recovery, tampered
job/binding/status/error fields, missing markers, contradictory accounting,
ambiguous HTTP 400 responses, failed receipt storage, and prevention of reposts.
The real shared-module runner test checks its displayed reason, no waiting or
candidate substitution, and no dispatch on engine resume.

All 43 supervised durability checks and four related test files passed with
external networking disabled. Scoped ESLint and the production build, including
TypeScript, passed. Retained logs: `/tmp/studio-yue2-refusal-final.log`,
`/tmp/studio-yue2-refusal-regressions.log`, and
`/tmp/studio-yue2-refusal-build.log`.

These use synthetic HTTP/storage transport, actual production adapters/runner,
and the existing native-audio fixtures. They are not another live GPU test or an
owner listening decision. No thumbnail work, legacy channel mutation, production
promotion, or publishing was performed. Musical qualification and the broader
MVP/backlog remain open.
