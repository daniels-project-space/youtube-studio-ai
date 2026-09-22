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
Graphify's code graph was refreshed. Live private R2 transfer qualification is
in progress; unit/SDK fixtures alone do not establish provider compatibility.

## Limits

This change does not establish owner approval of the music, qualify musical
quality, publish a video or promote the branch to production. It does not add
durable multipart resume across worker death or an overall upload deadline.
SDK per-request retries remain in effect. The complete render, transfer, QA and
delivery workflow still needs task-budget qualification in its deployed runtime.

Provider references: [R2 limits](https://developers.cloudflare.com/r2/platform/limits/)
and [S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/).
