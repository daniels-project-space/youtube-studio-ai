# Uncertain Continuation Recovery

The YuE2 resume dispatcher previously treated any Trigger exception as a
definite enqueue failure. If Trigger accepted a resume but its response was
lost, the next tick used a new attempt/key. Two lost responses could block the
approved checkpoint even though a delivery had already been accepted.

A regression through the actual dispatcher and Convex handlers reproduced the
attempt increment after an uncertain submission.

## Behavior

- Failure before submission and explicit HTTP 400/401/403/404/422 rejection keep
  the existing bounded enqueue-failure behavior.
- Lost responses, unknown post-submission exceptions and missing/blank returned
  run IDs preserve the current attempt and idempotency key.
- Preparing a pending receipt starts a fixed three-hour delivery window using
  the existing deadline field. Repeated preparation and uncertain acknowledgements
  never extend it. Expired pending receipts cannot claim execution and are
  blocked for reconciliation, not issued a new delivery identity.
- Trigger receives an explicit 24-hour idempotency TTL, longer than that window.
- A successful acknowledgement retains the existing queued/claim behavior.
  Confirmed queued-delivery expiry remains bounded to two delivery attempts.
- Worker deployment, owner/source approval, frozen invocation and source-stage
  identity checks remain mandatory. A late acknowledgement cannot revive an
  expired or revoked source. Other channels still receive their dispatches when
  one acknowledgement fails.

This changes only the new YuE2 continuation path. It does not generate music,
approve an audition, change legacy native-music delivery behavior or add a cron.
The existing optional deadline field is reused; no table-schema change is needed.
The updated backend must be deployed before the updated dispatcher.

## Evidence

Twenty-four cases across five selected files passed with external networking
disabled. They cover actual handler state transitions, lost and malformed Trigger
responses, identical repeated keys, immutable deadlines, expired execution
claims, explicit rejection, mixed-channel failure isolation, source-byte
verification, saved-run handoff and shared recovery transport.
Production build/TypeScript, scoped lint and structural audits also passed;
no audit baseline was changed.

Trigger and Convex transports are synthetic in this test boundary. These checks
do not establish live provider deduplication or production rollout. No thumbnail
test, GPU start, paid generation, publishing or deployment was performed.
