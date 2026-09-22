# YuE2 read-only pipeline preview

## Boundary

The channel preview endpoint accepts an explicit supervised `yue2Music` selection
and includes its exact source settings and implementation versions in the
pipeline fingerprint. The worker receives the same selection. Read-only graph
projection is separate from executable validation: runtime selection still
requires registered manifests, valid configuration, and compatible private
candidate consumers. Preview is not runtime, musical, or release qualification.

The source configuration and integer allocation policy now live in provider-free
contracts shared by preview, source execution, and accounting verification.
Seed, personal-creator acknowledgement, bounded allocation, execution window,
and policy reservation are validated without secrets or provider requests.
No default migration, listening approval, GPU start, or publication is implied.

## Dependency Isolation

Cold-preview testing exposed pre-existing transitive renderer imports in the
shared module catalog. Comic and whiteboard budget-bound helpers now live apart
from their renderer implementations. The renderers re-export the existing API
and import the same helpers. All 32 extracted declarations were compared against
the prior committed source and retained identical implementation text.

Golden catalog metadata now imports H3 constants from the existing admission
module instead of its storage/provider-backed runtime. This removes runtime
imports from every preview, not just YuE2. It is not a measured cost-saving claim.

## Evidence

- Five family/playback combinations compare full preview and executable graphs:
  primary Lo-Fi repeat, meditation repeat/once, narration once, and Shorts once.
- Worker-option projection and preview fingerprints agree; changing the source
  seed changes the fingerprint, and omitted selection retains the legacy route.
- A cold route test forbids Trigger, storage, bootstrap, executable block
  registration, and YuE2 runtime imports, and counts attempted HTTP calls.
- Invalid source budgets, reservations, acknowledgement, and extra provider
  settings are rejected. Runtime accounting and real source-block/runner tests
  retain their own independent authorization checks with synthetic transports.

Automatic production admission and owner listening requirements remain intact.
No new browser selector UI or production deployment is claimed by this change.

## Validation Result

The full non-thumbnail readiness run passed 895/896 selected files, with 30
thumbnail-named files excluded. Its sole failure exposed loss of the nested
`yue2Music` error path when a missing policy threw inside a schema transform.
The shared source schema now composes the policy schema directly and reports
allocation failures at the reservation field. The existing creator rejection
test was retained, not weakened.

After that correction, seven focused files passed all 18 reported tests,
including the creator endpoint, cold preview, runtime selector, worker transport,
execution accounting, and actual source-module runner. Stale legacy snapshots
are explicitly rejected against a selected YuE2 preview. Build/typecheck and
scoped ESLint passed. The full 896-file sweep was not repeated after the schema
correction; synthetic transport tests are not live music-quality evidence.
