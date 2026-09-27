# YouTube Studio R2 asset retention

The daily `r2-asset-retention-sweeper` reports generated run assets after a
confirmed public YouTube release plus 30 days, and final video masters after
release plus 180 days. R2 `LastModified`, terminal run state, a completed
release cleanup ledger, exact certificate binding, and an unlocked channel are
also required. Reusable library revisions, thumbnails, release evidence, and
explicit keep names are protected. The older release-aware sweeper now waits
30 days after confirmed publication and protects reusable library keys.

**Automatic deletion is currently limited to run-scoped
`novita/atlas-crops/...png`.** Its only application writer uses create-only PUT,
source-derived unique names, and provenance metadata. The shared storage APIs
reject overwriteable writes to this exact family. The deletion mutation itself
rejects every other kind and key, even if a caller misclassifies it. Fixed-name
final masters, footage clips, and other intermediates are report-only because
their writers allow replacement at the same R2 key. The user-requested 180-day
final cleanup therefore remains unimplemented until final writers have a
delete-safe immutable or reserved-key design.

The task requires the exact `youtube-studio-ai` bucket and an independently
configured `YOUTUBE_STUDIO_R2_ACCOUNT_ID` matching `R2_ACCOUNT_ID`. An explicit
`R2_ENDPOINT` must be the canonical endpoint for that account. No independent
account binding has been found in the current app configuration; without it the
task fails closed before listing or deleting. No bucket-wide lifecycle rule is
used because model/runtime weights and reusable assets share this bucket.

For each deletion the worker verifies exact R2 identity and atlas metadata,
records a Convex intent, observes the exact public/processed YouTube video on
its bound channel, transactionally rechecks release and reusable references,
then rechecks the R2 object before deletion. Pending intents prevent new
library promotion and channel locking. An uncertain delete stays pending while
the object exists; it is never canceled or automatically retried. Confirmed
absence permits the receipt and asset metadata to be finalized. A changed
object needs manual reconciliation. The task deletes at most 100 objects per
execution.

`scripts/report-r2-retention-candidates.ts INVENTORY.jsonl` is read-only. It
classifies the observed unbound `videocraft`, `lustig`, `imagecraft`, and
`validation` layouts. These have no authoritative Convex owner/run binding.
Validation visual-review evidence stays protected. At the 27 September 2026
inventory, 80 generated media objects (4.13 GB) were older than 30 days,
including 44 owner footage clips (4.10 GB). Seven noncanonical final videos
(1.08 GB) were found, none older than 180 days. All remain report-only.

No production candidate cleanup has been run by this change. An isolated
random object in the YouTube bucket proved R2 accepted `DeleteObject.IfMatch`
with a wrong ETag and still deleted it, so conditional delete is not used.
An out-of-band writer with bucket write access could bypass the app's
create-only atlas writer; credential scoping must exclude such writes before
live deletion is enabled.
