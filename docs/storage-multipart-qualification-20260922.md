# Large master storage qualification

## Root cause and shared fix

The retained eight-hour 1080p master is 12,983,194,060 bytes. The existing
`putObjectFromFile` helper always used one streamed PUT. Streaming prevented
whole-file memory allocation but did not bypass R2's 5 GiB single-PUT limit.
Assembly callers already use this shared helper, so the fix does not change
individual channels or legacy pipeline definitions.

Files above 64 MiB now use pinned `@aws-sdk/lib-storage` multipart uploads,
with two workers and 32 MiB parts. Part size grows only when needed to remain
within 10,000 parts. The SDK/client and temporary buffers add overhead beyond
the queued part payload; 64 MiB is not a total-process memory guarantee.
Both npm and pnpm lockfiles include the dependency.

Small files retain streamed PUT. Create-only writes retain single PUT through
5 GiB, and larger conditional writes refuse before dispatch: R2 multipart
conditional completion has not been qualified, so this change does not silently
weaken `IfNoneMatch`. Non-files and files beyond R2's object-size limit refuse.

The wrapper owns abort cleanup after part or completion failure. Cleanup targets
only the exact upload ID and waits for workers to settle. Request failures stop
further dispatch and destroy that upload's read stream, without modifying the
cached client's behavior for other uploads. A lost completion response never
triggers object deletion or automatic whole-upload retry. Missing upload during
abort preserves the original failure; other cleanup failures retain both errors.

## Verification

Network-isolated focused checks: 30 passed across multipart upload, bounded
reads, acknowledged deletion, private storage routing and prepared-result storage.
The multipart fixture runs the actual SDK uploader with a mocked transport and
a real 65 MiB file: byte hashes, ordered completion, metadata, private bucket,
two-worker bound, part/completion/create/missing-ETag failures, cleanup failure,
lost completion, conditional writes and invalid input. No thumbnails ran.

TypeScript, focused ESLint and the optimized Next.js production build passed.
Graphify's code graph was refreshed.

## Live private R2 result

On 2026-09-22 UTC, the actual retained eight-hour master was uploaded through
`putObjectFromFile`, then downloaded through `getObjectIntegrity` as a full
streamed SHA-256 check. The process exited successfully, with exact equality:

- Bytes: `12983194060`.
- SHA-256: `c413635329f976ab5b3d652e5708766883f4caa00aab231e39f6f2dc622e7d8d`.
- Upload acknowledgement: 261,650 ms from invocation start.
- Upload plus full remote hash verification: 382,284 ms.
- Independent HEAD: matching length, `video/mp4`, and expected purpose metadata.
- Multipart ETag: `3b6e90ffb7f74cd9e6cf9b8ea43e0d2b-387`; this is not used as a
  substitute for SHA-256.

Bucket: `youtube-studio-ai-private`.
Retained isolated test key:
`operator/qualification/multipart-20260922/ea633df1-f9ca-4f83-aa2b-92e2c0c90212/timing-master.mp4`.
This newly generated UUID key is not referenced by a live channel or run. The
object is retained as qualification evidence and consumes about 13 GB of private
storage. No existing object was deleted, no GPU started and no music generated.
Credentials were injected into the trusted test process from the Cloudflare vault
namespace; no credential value was written to source or the evidence receipt.

Machine-readable result:
`test-fixtures/music-composer/assembly/natural-loop-8h-r2-integrity.json`.
This validates the shared helper against real R2 using the existing local master,
not an end-to-end deployed Trigger run or production rollout.

## Limits

This change does not establish owner approval of the music, qualify musical
quality, publish a video or promote the branch to production. It does not add
durable multipart resume across worker death or an overall upload deadline.
SDK per-request retries remain in effect. The complete render, transfer, QA and
delivery workflow still needs task-budget qualification in its deployed runtime.

Provider references: [R2 limits](https://developers.cloudflare.com/r2/platform/limits/)
and [S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/).
