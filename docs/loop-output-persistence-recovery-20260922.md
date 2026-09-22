# Completed render persistence recovery

## Reproduced failure

The loop module protected generation and seam inspection errors, but its final
R2 upload was outside both cost-preserving catches. A transient upload failure
therefore reached the runner as permission to retry the whole paid stage.

The pre-fix actual-runner regression produced 12 synthetic H3 dispatches instead
of six after one failed upload. It also exposed that cloning a frozen provider
error discarded its separate observed-charge fields.

## Changes

- `persistRenderedFile` retries only an idempotent completed-file upload, with
  at most three logical attempts and the existing structured error/backoff policy.
  The underlying storage SDK retains its own bounded transport retries.
- Each attempt streams from the completed file. Loop output no longer allocates
  a whole-video buffer. The deterministic upscale stage uses the same helper.
- Authority checks run before each upload attempt, outside the storage retry
  catch. A withdrawn source approval is never treated as a storage retry signal.
- Exhausted, deterministic or unknown storage failures stop whole-stage retry.
  All post-render loop failures retain known clip charges, including upload and
  incomplete-output failures. Frozen errors preserve their original cost metadata.
- No rendering profile, prompt, resolution, seam threshold or musical decision
  changed. Bookkeeping remains non-fatal under the existing metadata helper.

## Verification

The actual runner recovers a transient upload with six video dispatches and
three sequence encodes, rather than regenerating them. Upscale recovery performs
one encode and two upload attempts. Persistent storage outage, HTTP 403, failed
seams and a frozen provider error retain the expected synthetic costs.

Focused helper tests cover three-attempt exhaustion, backoff, deterministic and
unknown error refusal, streamed-file arguments, and authority withdrawal between
attempts. Provider, storage and encoding transports are synthetic in these new
tests; the tests do not demonstrate live provider savings or rendered quality.

Build/typecheck, lint, structural audits and all nine combined
recovery/accounting/storage/YuE2 regression files passed. Results are retained in
`/tmp/studio-loop-persistence-combined-final-20260922.log`.
No thumbnail tests, paid generation or deployment were performed.

## Remaining boundary

This improves recovery while the completed local file is still available. It is
not a new cross-worker durable checkpoint for a partially finished paid stage.
Persistent outages still need explicit reconciliation; this change does not
authorize another paid render or claim full MVP/production readiness.
