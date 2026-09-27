# YouTube Studio R2 asset retention

The daily `r2-asset-retention-sweeper` reports generated run assets after a
confirmed public YouTube release plus 30 days, and final video masters after
release plus 180 days. R2 `LastModified`, terminal run state, a completed
release cleanup ledger, exact certificate binding, and an unlocked channel are
also required. Reusable library revisions, thumbnails, release evidence, and
explicit keep names are protected. The older release-aware hourly worker now
waits 30 days after confirmed publication, verifies the sealed release evidence,
and records completion without deleting R2 objects or asset metadata. The daily
worker uses that completed ledger as its release gate.
The legacy operator-triggered footage prune task is inventory-only even when
enabled; it cannot bypass the new deletion gates.

**Automatic deletion is limited to two future writer families:** run-scoped
content-hashed intro-card MP4s at release plus 30 days, and quiz-year or
quiz-short final MP4s named with their content SHA-256 at release plus 180
days. Each writer transactionally reserves the exact run key before its R2
upload and closes the reservation only after re-reading and hashing the stored
bytes. Quiz final files use create-only upload and matching digest metadata;
renders over R2's single-PUT limit fail closed. Shared storage APIs reject
overwriteable writes to either exact family. The deletion mutation itself
rejects other keys and an `asset` kind applied to a final. Existing fixed-name
final masters, footage clips, atlas crops without writer reservations, and
other intermediates remain report-only. Broad 30-day asset and
180-day final cleanup remains incomplete until those writers have a safe
immutable or reserved-key design.

The task requires the exact `youtube-studio-ai` bucket and an independently
configured `YOUTUBE_STUDIO_R2_ACCOUNT_ID` matching `R2_ACCOUNT_ID`. An explicit
`R2_ENDPOINT` must be the canonical endpoint for that account. The code also
pins the SHA-256 of the account ID verified by a read-only Cloudflare Get Bucket
request using the app vault's separate API token on 27 September 2026. The
deployment binding is still absent from current app configuration, so the daily
task logs a skip and returns before vault access, Convex queries, or R2 calls.
With a binding present, the exact account and bucket assertions still fail
closed before listing or deleting if their identities differ.
No bucket-wide lifecycle rule is
used because model/runtime weights and reusable assets share this bucket.

For each deletion the worker verifies exact R2 identity and writer metadata,
records a Convex intent, observes the exact public/processed YouTube video on
its bound channel, transactionally rechecks release and reusable references,
the completed writer reservation, and every asset row with that R2 key,
then rechecks the R2 object before deletion. Pending intents prevent new
library promotion, asset references, writer reservations, and channel locking.
An uncertain delete stays pending while
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
