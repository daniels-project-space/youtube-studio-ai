# Studio R2 retention class migration checkpoint

## Current lifecycle scope

The `v1` copy paths described below are historical nested keys. The current
bucket has R2 expiration rules only for root `released-ordinary/v2/` keys
(30 days after upload) and root `released-final/v2/` keys (180 days after
upload). These prefix rules do not expire general Studio assets. Reusable
library media and other objects outside those namespaces are outside their
scope. Studio's v2 readers enforce a separate `releaseAt + 30/180 days`
deadline, and its promotion fence rejects direct promotion from either
expiring namespace (`src/lib/r2AssetRetention.ts`,
`convex/r2ExpirationFence.ts`). See
[`R2_ASSET_RETENTION_2026-09-27.md`](R2_ASSET_RETENTION_2026-09-27.md) for the
exact live rules and the distinction from the application deletion sweeper.

This branch moves the only active reusable-media promotion writer to
`owner/<owner>/channel/<slug>/library/reusable-media/v1/<sha256>.mp4`.
The writer hashes the source bytes, uses an R2 create-only PUT, and verifies
the full bytes if a retry finds the object already present. The immutable
library entry then points at that permanent key. Existing entries and readers
continue to use their stored exact key. Generic storage APIs refuse
overwriteable uploads and ordinary deletion of this new key family.

Read-only live Convex inspection on 2026-09-27 (`dev:astute-camel-689`) found
215 `assets` rows and zero rows in `runArtifactRetentions`,
`r2AssetExpirations`, `r2ImmutableWrites`, `studioAssetLibraryEntries`, and
`studioReusableMediaAssets`. Those counts show no live library entries need
rebinding today; they do not prove any legacy R2 object is disposable.

The release observer now copies a certified final master when YouTube confirms
that exact video is public and processed. It writes a create-only
`runs/<run>/released-final/v1/<releaseAt>-<sha256>.mp4`, verifies the source
digest and the copied bytes, and records the release timestamp and its 180-day
deadline in both R2 metadata and the Convex retention receipt. Library and run
playback use the copied key; the original certificate source stays available
for QA and thumbnail lineage. A failed copy defers release recording. A master
larger than R2's single-PUT limit uses conditional multipart completion with
`If-None-Match: *`. The source HEAD ETag is required on its GET, then the full
download SHA-256 and byte length are checked against the certificate before
upload. The source ETag is stored in the copy metadata and Convex receipt.

Cloudflare's [R2 release notes](https://developers.cloudflare.com/r2/platform/release-notes/)
say conditional multipart publish is supported and a failed condition aborts
the upload. The [R2 S3 compatibility table](https://developers.cloudflare.com/r2/api/s3/api/)
lists `CompleteMultipartUpload` but does not enumerate that header; the
installed AWS SDK sends `IfNoneMatch` on `CompleteMultipartUpload`. A bounded
live probe on 2026-09-27 wrote two 6 MiB multipart attempts to one random
`codex-probes/conditional-multipart/` key in the Studio bucket: the first
completion succeeded, the second returned HTTP 412, and the original ETag and
full SHA-256 were unchanged. The exact probe key was removed and HEAD returned
404. No production media key was touched. The production writer uses the same
conditional completion and verifies the resulting full bytes on R2 before
recording a release receipt.

The 180-day receipt is an application expiry schedule, not deletion authority.
This historical nested `v1` final-copy key is outside the root `v2` lifecycle
prefix, and original certificate sources stay protected. Historical keys and
other release readers still need a full reference migration before any
additional final media can be deleted safely.

New Lo-Fi runs mark the accepted per-run Novita keyframe asset as
`lofi-keyframe/v1`. At confirmed release, the observer selects that exact
marked asset, binds its source ETag to a download, computes the full SHA-256,
and writes a create-only `runs/<run>/released-keyframe/v1/<releaseAt>-<sha256>.png`.
R2 metadata and the Convex receipt record the source asset/key/ETag, digest,
release time, and 30-day deadline. The run media workbench projects the copy
for that exact asset ID; the original asset row and key remain
for rendering and provenance. A marked asset with an unsuccessful copy defers
release recording. Older unmarked keyframes, thumbnails (including Nano Banana
Pro), and reusable library media are outside this path. This is a retention
receipt only: the 30-day keyframe copy has no enabled deletion path.

The same verified byte copier now covers two more explicit Lo-Fi run assets:
the `clip` row for `loopraw.mp4` and the `loop_unit` row for
`loopunit_{2k,4k,1080p}.mp4`. Their writers mark the rows, and the release
observer copies only the latest marked row of each class to an immutable
`released-ordinary/v1/<class>/<assetId>/<releaseAt>-<sha256>.mp4` key. Each
copy has source key/ETag, full digest, row ID, class, and 30-day expiry in
metadata and a Convex receipt. The run media workbench projection uses a copy
only when its row ID, kind, original key, and release time all
match; an expiration intent hides that copy. A failed copy defers release
recording. There is no live writer of the schema's old `upscaled` kind, so
those legacy rows remain untouched. Other clips and loop units, thumbnails,
reusable music, and final videos remain outside this ordinary class.

The application deletion path remains disabled by the independent
`YOUTUBE_STUDIO_R2_ACCOUNT_ID` binding. The R2 lifecycle rules are already
configured only for the two root `v2` prefixes above; do not enable the
application sweeper or broaden those rules to other keyspaces. Remaining gates:

1. Inventory every legacy object and its live and historical pointers, then
   reconcile unknown keys and unregistered writers. The existing bucket has
   2,427 objects outside future class prefixes.
2. Remove or scope the four known account-wide R2 write tokens, audit unknown
   user tokens, and prove no writer can overwrite an expiry-managed key.
3. Move remaining ordinary generated asset writers to a 30-day class; finish final-video
   reader/certificate reference migration and exercise a real large-master
   release replay before extending 180-day expiration to legacy final/source keys.
4. Audit promotions from every other library writer. Copy and verify bytes
   into a permanent key before rebinding an immutable library revision; keep
   historical revisions protected until their references are accounted for.
5. Exercise the full read, release, retention, lock, promotion, crash-recovery,
   and expiry path on a disposable scope before setting the application
   deletion binding or broadening either Cloudflare lifecycle rule.

This change performs no R2 deletion, lifecycle mutation, Trigger resume,
or paid render.
