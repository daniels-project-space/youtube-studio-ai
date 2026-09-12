# Plan-week bulk receipt (12 September 2026)

The bounded `/api/plan-week/bulk` fan-out now has a durable Convex parent
receipt in `planWeekBulkOrders`.

- `planWeekBulkOrders.admit` is service-only, owner-scoped, idempotent by
  `(ownerId, requestKey)`, and verifies the active contract, sorted channel
  set, item count, and combined reservation before any child Trigger is
  enqueued.
- `planWeekBulkOrders.markDispatched` records the exact child Trigger IDs only
  after every parallel dispatch returns. A retry with the same fingerprint must
  replay the same parent and child identities rather than minting a second
  order.
- `GET /api/plan-week/bulk?fingerprint=…` returns the owner-scoped receipt and
  its child handoff statuses with `private, no-store` caching, so schedule or
  overview surfaces can poll progress without re-enqueueing anything.
- `planWeekBulkOrders.markChildStarted` and `markChildFinished` now bind each
  child to its exact Trigger run and aggregate `running`, `succeeded`, or
  `failed` parent state. The start mutation is race-safe when a child begins
  before the dispatch receipt is written, and Trigger retries may resume the
  same failed child without changing its identity.
- The receipt still is not a claim that Salad/provider work completed. Per-channel
  `plan-week-ahead` owns its budget, provider, artifact, and recovery gates; a
  later slice must add durable Salad work-order claims and aggregate cost
  reconciliation before the weekly fleet is considered complete.

Focused order and wiring tests, typecheck, lint, and production build passed
for commit `71753b4` and the follow-up receipt-status slice. No provider
or paid render was invoked by this change.
