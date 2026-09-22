# One HTTP attempt for stable durable deliveries

The installed Trigger 4.5.9 API client defaults to five HTTP attempts, independently
of a task's own retry setting. A shared recovery task with `maxAttempts: 1` can
therefore still multiply enqueue traffic during a provider outage.

Bundle fanout and serialized-episode recovery now pass the supported fourth
`tasks.trigger` argument, `{ retry: { maxAttempts: 1 } }`. These two durable
outboxes retain the same global delivery identity after uncertain transport.
The next eligible recovery tick, not an in-process SDK backoff loop, owns another
attempt. Claims, deferral, batch limits, concurrency, not-before times, worker
versions and downstream execution fences are unchanged.

This can delay transient-error recovery until the next eligible tick. It also
reduces a failed enqueue's maximum immediate HTTP attempts from five to one
under the installed default. That is a request-count result, not measured
production billing savings or cancellation of a submitted task.

The change deliberately does not cover review/qualification continuations:
several of their failure mutations advance attempt counters used in delivery
identity. Their uncertain-outcome behavior needs separate proof before reducing
SDK retries. No generic all-Trigger retry policy was changed.

## Verification

`durableDeliverySdkRetries.test.ts` uses the installed SDK, real global-key
generation, actual request options extracted from both dispatch calls, and a
local HTTP server. Its inherited-policy control makes five requests. Updated
calls make exactly one request for HTTP 503, HTTP 429 and a dropped connection
after the fixture server accepts a submission. A later call resolves the same
fixture identity with unchanged payload and worker pin. Retry delays are shortened
in the test configuration; no external Trigger request or child execution occurs.

The real dispatcher-body tests also require the fourth SDK argument and retain
their checks for claims, busy refusal, global keys, invocation hashes, exact
worker pins, not-before delays, poison-receipt isolation and four-call serialized
concurrency. The shared idle/stall integration and installed-SDK worker-version
transport checks remain applicable.

## Remaining Transport Limit

The installed `ApiRequestOptions` exposes retries and additional headers, not an
enqueue abort signal or timeout. `tasks.trigger` calls native fetch without a
request deadline. This patch does not claim to fix a socket that never settles.
No `Promise.race` was introduced to leave an unobserved submission running, and
global fetch was not patched across concurrent workers. Explicit Convex request
deadlines from the preceding batch remain in place.

Shared schedule activation, busy-outbox load verification, approved production
delivery and actual cost measurements are still outstanding. No channel,
thumbnail, GPU, publishing or production configuration changed.
