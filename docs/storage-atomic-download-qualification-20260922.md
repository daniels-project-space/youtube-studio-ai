# Atomic large-media recovery

## Reproduced failure

`getObjectToFile` streamed directly into its final destination. A realistic
interrupted-response test against the old implementation replaced an existing
24-byte complete file with an empty file. A short, normally ended response also
had no helper-level ContentLength check. This is a shared storage defect used
by module-output rehydration and the publish dispatcher, not a channel-specific
renderer change. Existing release SHA-256 gates are not removed or weakened.

## Repair

Downloads now use a private, uniquely owned sibling directory and a 0600 file.
Disk preparation precedes the GET, so an invalid local parent starts no network
transfer and no asynchronous setup leaves a live response without pipeline error
handlers. Streaming byte counts reject invalid headers, early EOF and overflow.
Only a completed file is renamed into the requested destination on the same
filesystem. Failure destroys the stream and removes only that attempt's scratch
directory, preserving an existing destination and concurrent successful work.
No additional HEAD, full-buffer allocation, or automatic transfer retry is added.

Missing ContentLength remains supported without claiming length verification;
valid zero-byte objects remain supported. This is atomic visibility, not an
fsync/power-loss durability guarantee or a SHA-256 replacement. Process death can
leave an unreferenced scratch directory for normal workspace cleanup. Replacing
an existing large file temporarily requires space for both complete versions.

## Verification

The final network-isolated selection passes 22 tests across six files: atomic
download, multipart upload, bounded reads, demand-driven recovery, recovery
subsets and publish-release retries. The new fixture makes 17 real helper GET
attempts with a mocked SDK transport and real files. It covers interruption,
truncation, overflow, malformed lengths, paused transfer visibility, competing
success/failure, rename failure, absent body, provider rejection, headerless and
empty objects. The real rehydrator rejects a truncated response as an error,
not as a reusable artifact or a confirmed missing object eligible for rerender.

An earlier 24-test selection accidentally included legacy thumbnail-resume and
thumbnail-byte release assertions embedded in two general suites. Those suites
were excluded from the final selection after inspection. No thumbnail generation,
thumbnail source edits, new GPU work or publishing occurred.

Final focused ESLint and the production build including TypeScript passed.
Graphify was updated after the last source edit.

## Exact-code live proof

The final `src/lib/storage.ts` source SHA-256 is
`229d34a133b16e04e31ce333501e8c9690521de717db994732d85181e317349b`.
That version downloaded the retained private eight-hour master through the real
R2 helper, then independently streamed the local file into SHA-256:

- 12,983,194,060 bytes; exact match to the retained master.
- SHA-256 `c413635329f976ab5b3d652e5708766883f4caa00aab231e39f6f2dc622e7d8d`.
- Download 149,244 ms; download plus local hash 178,180 ms.
- Peak process RSS 140,108 KiB, about 137 MiB; a single observation, not a fleet bound.
- 1,490 destination observations at a nominal 100 ms interval found zero partial
  destination sizes. Controlled paused-stream tests independently prove the
  visibility boundary; polling alone cannot prove every instant.
- No scratch directory remained after the helper returned. The completed local
  test copy was then removed, and the verifier exited zero.

An earlier successful live run preceded the setup-order tightening and is not
substituted for this final-code measurement. The original private R2 evidence
object is unchanged; no second R2 object was created. Vault credentials were
injected only into the trusted validation child process.

Receipt: `test-fixtures/music-composer/assembly/natural-loop-8h-atomic-download.json`.
This branch is not promoted to production. The full deployed render/QA/upload
task budget, musical quality qualification and owner music approval remain open.
