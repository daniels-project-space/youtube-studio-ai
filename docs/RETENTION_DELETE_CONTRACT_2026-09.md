# Retention deletion acknowledgements — 9 September 2026

## Confirmed defect and change

The production `deleteObjects` helper requested quiet S3 deletion and incremented its count by the number of requested keys. It never inspected per-object errors. Consequently, an HTTP 200 response with failed deletions could let the retention worker prune its asset rows and mark the ledger complete.

This behavior is explicitly allowed by the [S3 DeleteObjects contract](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html). HTTP success is not object-level success. [R2 implements the S3-compatible operation](https://developers.cloudflare.com/r2/api/s3/api/).

The helper now requests verbose acknowledgements, validates every returned exact key, rejects missing/duplicate/foreign/contradictory results, and stops later batches on failure. It deduplicates inputs without trimming or normalizing object names and still uses at most 1,000 keys per request. The typed error carries only confirmed counts, not provider error bodies. An acknowledged absent key means confirmed absence, not proof of a new physical deletion.

The actual retention prune caller now rejects duplicate or out-of-run listing entries before deletion, checks the exact returned count, and preserves known partial counts and retained evidence on failure. The worker no longer describes partial cleanup as “preserved”; its total includes confirmed storage results even if a later database write fails. It does not prune asset rows or complete the ledger after an incomplete storage acknowledgement.

The worker also requests only the Cloudflare and YouTube vault services. The real idle entry-point test observes exactly two service requests instead of the general bootstrap's 20 configured services. This is a deterministic call-count improvement, not a measured cloud latency or billing claim.

## Evidence

- Before the fix, both new regressions (HTTP 200 with per-object failure; empty acknowledgement) failed with `Missing expected rejection`. Baseline log: `/tmp/ysa-storage-deletion-baseline.log`.
- Seven storage tests now exercise valid multi-batch requests, exact byte-preserving keys, invalid inputs, malformed replies, partial second-batch failure, lost responses and absent acknowledgements.
- The actual certificate/integrity/prune tests verify other-run refusal, short/invalid counts, partial failure followed by retry, and preservation of parent/derivative final masters plus their compact verification evidence. The fixture really removes the targeted keys from its storage map.
- The actual idle sweeper entry point runs with controlled vault/Convex transports. It requests only the two required services, reads release checks and makes one empty claim; it makes no provider-render or deletion request.
- Live R2 check using the production SDK/helper passed against `salad-render-infra`, prefix `salad-media-tests/2026-09-09/delete-contract-b4d605d1-0e7f-4dd4-8c4c-ed721b50b828/`. Three uniquely named tiny text fixtures were created with create-only writes. Two intermediates were deleted while the sentinel was read back unchanged, already-absent retries were acknowledged, then the sentinel was removed. Final listing was empty. No channel/video/model objects were touched. Log: `/tmp/ysa-r2-deletion-live.log`.
- Reproducible explicit opt-in probe: `scripts/verify-r2-deletion-contract.ts --allow-isolated-storage-test`. It cannot target channel namespaces or accept arbitrary bucket/prefix deletion targets.

## Scope and remaining work

This is a deletion-contract repair, not completion of items 125–127 or the weekly media system. No real video was published or expired for this test. Controlled error responses are not live R2 access-denial injection. Unknown transport outcomes stay unknown; partial deletion is not atomic or reversible.

The next retention boundary needs a fresh check immediately before destructive work: a lease/release observation validated at claim time can age while a large final master is hashed. Current claim checks also do not use the channel write-lock guard. Those checks must be wired to the existing service identity, channel ownership/lock, connector/run identity and release ledger—not invented as an independent authorization system. They need real handler tests for lease expiry, revocation and identity changes during verification. Prepared-media adoption into assembly remains a separate open requirement.

## Release validation

Focused tests, typecheck and scoped live storage validation passed. A clean release candidate based on production `f7e954b` contains only the retention repair and its tests/probe, excluding the held title-generation and Salad work. Full regression, build and deployment results will be recorded after completion; a checkpoint alone is not a production receipt.
