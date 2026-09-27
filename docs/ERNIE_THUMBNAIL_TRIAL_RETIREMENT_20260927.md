# Retiring the ERNIE native thumbnail trial batch

The one-shot, 30-image trial under `projects/thumbnail-refresh/ernie-native-v1/`
was a reviewed comparison batch, not the reusable ERNIE model lane. This change
retires its hidden preview and apply endpoint and removes the batch Trigger task
from source. It preserves imported candidate records, their owner/run thumbnail
objects, historical approval types, and the general ERNIE render path.

## Read-only live audit, 2026-09-27

- Studio R2 `youtube-studio-ai` contains exactly 31 objects under the trial
  prefix: 30 PNGs and one manifest, 46,326,340 bytes total. The manifest SHA-256
  still matches its pinned digest `da68b70163fe25149b8144af7a7a9b7be4bc231d5a88e2b7fff4295953002d62`.
- The 30 manifest source runs all exist with status `ok`. Two historical
  `ernie-thumbnail-batch-apply` Trigger runs, both from 2026-09-08, are
  `COMPLETED`; there are no active or queued runs for that task in the live
  one-year task-filtered inventory. Live Convex shows 27 candidate imports;
  the second run reported 24 replacement queues and six blocked attempts.
- Of the 30 sources, 27 have an imported candidate. All 27 candidate thumbnail
  objects exist under separate `owner/owner_daniel/channel/.../runs/.../thumbnail.png`
  keys, and each R2 HEAD metadata SHA-256 matches the reviewed trial manifest.
  Three sources have no imported candidate and remain abandoned trial work.
- Live owner Convex inventory has 215 assets and 24 replacement records. None
  of their storage keys points at the trial prefix; no asset metadata contains
  that prefix. Of the 24 replacement records, 23 are blocked and one is still
  marked queued in Convex. The queued record's exact Trigger run is `FAILED`,
  and its candidate key is one of the separate owner/run copies. Its stale
  status needs its ordinary replacement recovery/owner review, not the trial
  batch source files.

The live `.env.local` S3 credentials returned HTTP 401, so the R2 inventory and
HEAD checks used current Project Hub vault credentials in one child process.
No bucket object or production state was changed during this audit.

## Release and deletion fence

This source change alone does not remove the already deployed Trigger task.
Keep the trial R2 objects until the retired Vercel route is live, a later
explicitly authorized Trigger deployment has removed the batch task, and a
fresh read-only audit confirms zero active/queued task runs and zero direct
Convex references to the prefix. Recheck all 27 retained owner/run thumbnail
copies before deleting the trial prefix. Do not delete the imported copies,
the general ERNIE model/runtime assets, proven Nano Banana Pro thumbnails, or
the personal travel-film bucket. No deletion or Trigger resume is part of this
change.
