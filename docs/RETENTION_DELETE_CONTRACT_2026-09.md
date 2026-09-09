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
- The actual claimed-work sweeper also runs through real certificate verification, byte hashing and the storage wrapper, with controlled SDK/database transports. Partial storage failure cannot call `assets.pruneRun` or ledger completion. Full success calls both in order. A database failure after successful deletion reports the confirmed storage count without claiming the files were preserved. Log: `/tmp/ysa-retention-sweeper-outcomes.log`.
- Live R2 check using the production SDK/helper passed against `salad-render-infra`, prefix `salad-media-tests/2026-09-09/delete-contract-b4d605d1-0e7f-4dd4-8c4c-ed721b50b828/`. Three uniquely named tiny text fixtures were created with create-only writes. Two intermediates were deleted while the sentinel was read back unchanged, already-absent retries were acknowledged, then the sentinel was removed. Final listing was empty. No channel/video/model objects were touched. Log: `/tmp/ysa-r2-deletion-live.log`.
- Reproducible explicit opt-in probe: `scripts/verify-r2-deletion-contract.ts --allow-isolated-storage-test`. It cannot target channel namespaces or accept arbitrary bucket/prefix deletion targets.

## Scope and remaining work

This is a deletion-contract repair, not completion of items 125–127 or the weekly media system. No real video was published or expired for this test. Controlled error responses are not live R2 access-denial injection. Unknown transport outcomes stay unknown; partial deletion is not atomic or reversible.

At release `139337e`, the next retention boundary still needed a fresh check immediately before destructive work: a lease/release observation validated at claim time can age while a large final master is hashed, and claims did not use the channel write-lock guard. The follow-up below addresses those checks. Prepared-media adoption into assembly remains a separate open requirement.

## Release validation

Release `139337e6e7d0b33dea4119c5141fceda06ee1781` is based on production `f7e954b` and contains only this repair, tests/probe and report. The held title-generation and Salad work are excluded.

- Clean parent candidate `34fa2f8`: all 629 direct test files and the actual 31.02-second 1920×1080 hermetic assembly passed. Nine extracted frames covering start, clip changes and ending fade were visually inspected at `/tmp/assembly-smoke-i6SJAg/retention-release-frames.png`. This synthetic regression is not real channel-quality qualification.
- Final `139337e` adds only the claimed-worker outcome tests and this report. Those tests and final typecheck passed in the isolated release checkout. Application runtime sources are unchanged from the fully tested/built parent.
- Production build passed after replacing an unsupported out-of-root dependency symlink with a local dependency copy. No build configuration or package version was changed. Lint: zero errors, 33 existing warnings. All structural audits were unchanged; all 24 defect proofs still demonstrated their baseline cases. Python worker checks: 29 passed. The canonical pnpm audit had no high/critical findings; four moderate advisories remain (not waived or described as zero vulnerabilities).
- By 10:14 UTC, Vercel reported deployment success and the exact production `/api/health` returned `139337e6e7d0b33dea4119c5141fceda06ee1781`.
- Live read-only inspection of run `js74tws8jvgzc4tvat86htgv4h88ny68` showed the current thumbnail, the preserved legacy/no-inferred-deletion message, no page errors or horizontal overflow, and three loaded media elements (video 340.5s, music 171.744s, narration 325.476s; no media errors). Screenshot inspected at `/tmp/ysa-retention-release-ziXHWC/production-run-loaded.png`. This verifies presentation/read access, not a real scheduled cleanup or full playback/quality review.
- [Cloud CI 34338714736](https://github.com/daniels-project-space/youtube-studio-ai/actions/runs/34338714736) completed successfully. Canonical Convex functions were ready at 10:22:24 UTC; Trigger production version `20260909.7` deployed at 10:24:23 UTC (worker `worker_cmttyb2dl3cx40poftv130ecv`, content hash `99c062448760340a6c0ae7af9beb0425`). The exact web alias was rechecked and still returned `139337e`. This confirms the deletion-acknowledgement release, not the follow-up draft below.

## Follow-up: authority immediately before deletion

The owner-lock regression failed before implementation: a locked channel was still claimed and its attempt counter incremented. `/tmp/ysa-retention-authority-baseline.log` preserves that failing actual-handler test. Claims now skip locked channels without consuming an attempt.

After byte verification and listing, the actual worker obtains a new exact-video YouTube observation and calls the existing authenticated Convex boundary before every R2 deletion batch. The server rechecks the lease against server time, frozen run/certificate/keep-set binding, owner/channel/run identity, channel lock, connector identity/version, and actual public/processed release plus fourteen days. This is a service-only mutation, not a browser bypass or independent permission system. Reauthorization never extends a lease. An unchanged observation does not rewrite the ledger; the worker reuses its provider read for at most 150 seconds before refreshing it. That bounds provider calls, but the extra deletion checks are intentionally additional work, not a call-saving claim.

The storage wrapper requires each returned grant to be unexpired and caps the SDK request/retry lifetime at the earlier of 30 seconds and that grant's deadline. Rejection between batches preserves earlier confirmed counts and sends no later batch. An empty-intermediate retry still requires current authority before asset-row pruning/completion; it sends no empty storage request.

Targeted validation covers real Convex handlers, the actual worker, certificate byte verification, encrypted connector loading, provider-response parsing and the S3 wrapper with controlled transports. Tests exercise 22 changed identity/lease/scope boundaries, missing records, unauthenticated/viewer/foreign service callers, stale/future/private/unprocessed observations, valid long verification, partial failure and retry, permission revocation between batches, and in-flight deadline cancellation. Eleven worker outcomes include a lock or expiry during verification, connector/run change, provider outage and authorized/locked empty retries. Logs: `/tmp/ysa-retention-authority-ledger.log`, `/tmp/ysa-retention-authority-storage.log`, `/tmp/ysa-retention-authority-sweeper.log`. Full isolated-release validation and deployment of this follow-up are pending at this checkpoint.

Limits: Convex authorization and R2 deletion are not one atomic transaction. A revocation after the last server check cannot roll back an already accepted storage request; an aborted/lost response still has an unknown outcome. Real production release-to-expiry cleanup has not been forced or claimed. Malformed storage-list pagination and prepared weekly asset adoption remain separate open checks. No paid model/GPU call, real channel file deletion, publishing, thumbnail change or lock bypass was used in these tests.

## UI follow-up from actual production inspection

The saved caption file currently receives a large empty visual-preview region, and the media grid stretches nonvisual file cards to the selected video's height. The screenshot confirms these are layout issues, not missing data: caption signing completed and all three media elements loaded. Keep the main preview prominent, move captions/documents to compact actionable file rows, and make audio controls appropriately sized. Validate the redesigned arrangement at desktop/mobile/enlarged text with current thumbnail selection, source links and historical proof preserved; this release does not claim that UI redesign is done.
