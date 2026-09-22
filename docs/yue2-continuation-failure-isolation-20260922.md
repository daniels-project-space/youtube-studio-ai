# YuE2 continuation failure isolation

## Change

One failed Convex acknowledgement previously exited the YuE2 continuation loop,
leaving every later approved channel unattempted. The dispatcher now attempts the
remaining receipts before returning a sanitized failure count. Both successful
enqueue acknowledgements and failed-enqueue records receive this isolation.

Delivery remains serial and bounded to 25 receipts. Oversized batches fail before
enqueue or acknowledgement. Global idempotency seeds, frozen worker bindings,
approval envelopes, SDK retries, and database attempt transitions are unchanged.
An uncertain acknowledgement is not recorded as a new failed delivery.

## Verification

- Actual dispatcher body with fixture transports: first-receipt acknowledgement
  failure, enqueue plus acknowledgement failure, recorded enqueue failure,
  foreign worker environment, and healthy 25-receipt delivery.
- Later channels complete before a batch failure is reported; provider/database
  exception text is excluded from that report.
- Existing actual-handler tests retain lost-acknowledgement idempotency, approval
  revocation, bounded delivery attempts, execution claims, and source integrity.
- Shared recovery HTTP integration checks the real Convex client and all recovery
  handlers with local fixtures, including stalled response isolation.

These are local regression tests, not live Trigger delivery or owner listening
approval. No GPU generation, thumbnail generation, or deployment was performed.
The Trigger SDK request still has no application-level timeout; this change does
not isolate a request that never settles or remove legacy music-loop latency.

## Duration policy

The owner approved natural-length Lo-Fi, sleep, and meditation loop sources while
requiring assembly to deliver the exact final video duration. This recovery change
does not broaden that approval to once-playback or background sources, alter the
retained music, or approve any candidate automatically.
