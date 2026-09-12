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
- The receipt is an admission/dispatch handoff, not a claim that provider work
  completed. Per-channel `plan-week-ahead` still owns its own budget, provider,
  artifact, and recovery gates. A later slice must add child terminal updates,
  durable Salad work-order claims, and aggregate cost reconciliation before the
  weekly fleet is considered complete.

Focused order and wiring tests, typecheck, lint, and production build passed
for commit `4c9c36a`. No provider
or paid render was invoked by this change.
