# Bound recovery database transport

The six delivery handlers used a Convex HTTP client without an explicit request
deadline. Shared recovery waits for every handler, so a stalled response could
retain an aggregate tick while subsequent scheduled ticks started more work.
Its two-hour project ceiling is a final process bound, not a request deadline.

`StudioConvexHttpClient` now supports an opt-in positive `requestTimeoutMs`.
All six non-thumbnail recovery owners use 30,000 ms. Each request gets a fresh
abort signal, composed with caller cancellation. The signal covers both headers
and body consumption. Authentication and custom transport remain intact; other
client users retain their previous behavior. YuE2 continuation uses the music
handler's same bounded client, without another cron or idle query.

A transport timeout does not establish that a mutation rolled back. No retry,
refund, new approval or new purchase is introduced. Existing outbox state,
lease fencing, global idempotency keys, worker pins and uncertain-acknowledgement
handling remain authoritative. The aggregate deadline and batch limits were not
shortened. Trigger SDK enqueue transport is not changed or newly bounded by this
patch; this is specifically the Convex request layer.

## Evidence

- `convexRecoveryDeadline.test.ts` uses the installed Convex SDK and native
  fetch against a local HTTP server. Missing headers and partial JSON bodies
  abort. A timed-out mutation is allowed to commit on the test server and is
  not silently resubmitted. The mutation queue recovers; later requests use
  fresh signals. Caller cancellation, unchanged legacy signal behavior and
  invalid timeout rejection pass. The test uses 50 ms deadlines.
- `sharedDeliveryRecoveryTransport.test.ts` executes the actual aggregate and
  all six actual handler bodies through that SDK and local HTTP server. Two
  overlapping idle ticks make exactly 16 database requests and no enqueue or
  provider calls. A stalled music request, before headers or mid-body, does not
  suppress the other five outboxes; the aggregate reports only music failure.
  A later healthy tick succeeds. Constructors must request the production
  30-second limit; the fixture scales it to 200 ms. This proves idle/stall
  transport behavior, not live-load latency or approved-work delivery.
- Existing shared recovery, delivery/provider isolation, YuE2 recovery dispatch
  and benchmark payload suites pass. These preserve deployment context, global
  identity, leases, worker pins, serialized batch/concurrency limits and failure
  isolation. Typecheck, focused lint and the production build pass; final test
  additions also pass typecheck/lint.

No production schedules, channel records, model settings, quality gates or
thumbnail code/tests changed. No GPU, publishing or paid generation was used.
Shared recovery activation, Trigger transport stalls, busy-outbox load evidence
and production cost measurements remain outstanding. This is not a claim of
realized monthly savings or completion of the full module-first MVP.
