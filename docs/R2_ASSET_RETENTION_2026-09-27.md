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

**Automatic deletion is limited to three future writer families:** run-scoped
content-hashed intro-card MP4s and storyboard atlas crop PNGs at release plus
30 days, and quiz-year or quiz-short final MP4s named with their content
SHA-256 at release plus 180 days. Each writer transactionally reserves the exact run key before its R2
upload and closes the reservation only after re-reading and hashing the stored
bytes. Quiz final files use create-only upload and matching digest metadata;
renders over R2's single-PUT limit fail closed. Shared storage APIs reject
overwriteable writes to either exact family. The deletion mutation itself
rejects other keys and an `asset` kind applied to a final. Existing fixed-name
final masters, footage clips, older atlas crops without full derivative digests and writer reservations, and
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

## Binding audit, 27 September 2026, 19:07 UTC

The saved read-only live inventory at
`/root/render-rebuild-audit/r2-object-inventory-live-2026-09-27.jsonl`
(file timestamp 16:27 UTC) contains 2,427 objects in `youtube-studio-ai`.
The run namespace contains 60 fixed-name `final.mp4` objects (11.39 GB)
and other fixed-name media; the bucket also contains model/runtime families
such as `aiinfra` (104.38 GB), `models` (39.59 GB), and `wan-weights`
(18.15 GB). A bucket-wide 30-day rule would therefore be unsafe. The
read-only candidate report at 19:07 UTC identified 80 old unbound generated
media objects (4.13 GB), seven unbound final videos (1.08 GB; none 180 days
old), and 655 validation evidence objects. The 80 generated objects remain
report-only because age and prefix alone do not prove ownership or absence
of reusable references. The personal `travel-film-editor` bucket is separate
and must remain untouched.

The first S3 `ListObjectsV2` and `HeadObject` attempts with the checkout's
local credentials returned HTTP 401. The account ID still matched the pinned
account and the endpoint was canonical with the required `auto` S3 region.
The Project Hub `cloudflare` vault held a different access-key pair. Using it,
`HeadObject` for a known Studio final and `ListObjectsV2` both returned HTTP
200. This establishes that the local pair is stale, not that R2 is unavailable.
The Trigger production environment has `R2_BUCKET` and `VAULT_ACCESS_TOKEN`
but no direct R2 key/account override; its normal worker bootstrap reads the
vault's `cloudflare` service. The exact runtime value of its vault bearer was
not exposed by this read-only check.

At 19:23 UTC, the vault's independent `R2_API_TOKEN` returned HTTP 200 from
Cloudflare's official Get Bucket and Get Lifecycle routes. The bucket is in
the default jurisdiction. Its sole active lifecycle rule aborts incomplete
multipart uploads after 604,800 seconds (seven days); **no object-expiration
rule exists**. A fresh, fully paginated S3 listing returned 2,427 objects and
203,696,950,292 bytes, matching the saved inventory. Account-token listing
through the vault's `WORKERS_API_TOKEN` returned four active account-owned
tokens, all with account-wide R2 Storage Write. The vault's working S3 access
key corresponds to one of them; the stale local key corresponds to none.
User-owned token listing returned HTTP 403, so that class of writer has not
been inventoried. Other account-wide write tokens can overwrite a managed
object outside the app's reservations and defeat the final HEAD-before-delete
identity check through a race. Read-only credentials cannot rule this out.

Repeat the credential and lifecycle check with
`scripts/diagnose-studio-r2-retention.ts`. It uses `listByService("cloudflare")`
when an authorized `VAULT_ACCESS_TOKEN` is present. The Codex operator can
instead inject only fresh Project Hub values into that one process:

```bash
STUDIO_R2_DIAGNOSTIC_VAULT_INJECTED=1 /root/.local/bin/codex-vault-exec cloudflare \
  R2_ACCOUNT_ID=R2_ACCOUNT_ID R2_ENDPOINT=R2_ENDPOINT \
  R2_ACCESS_KEY_ID=R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY=R2_SECRET_ACCESS_KEY \
  R2_API_TOKEN=R2_API_TOKEN -- \
  node_modules/.bin/tsx scripts/diagnose-studio-r2-retention.ts \
  lustig-short/final_2k.mp4 /home/ubuntu/youtube-studio-ai/.env.local
```

The script pins the account and canonical endpoint, uses S3 region `auto`,
checks a bounded `owner/` list and exact HEAD, and reads the bucket and
lifecycle through the official Cloudflare API. It reports only status,
failure class, lifecycle rules, and whether the checkout key differs. A 401
with a different checkout key points to stale local credentials; a 403
indicates scope, a 404 HEAD indicates the probe object is missing, and a
transport or other provider failure stays inconclusive. Supply a current
known key as the first argument if the default example has been removed.
No write, delete, lifecycle PUT, or retention binding is performed.

Before setting `YOUTUBE_STUDIO_R2_ACCOUNT_ID`, exclude external writers from
the managed key families, audit user-owned tokens and Worker bucket
bindings, and dry-run against current Convex release/reference state. The
30/180-day policy cannot be expressed as a bucket-wide lifecycle rule in this
mixed bucket. Keep the production Trigger environment and queues paused while
Studio is not ready. No lifecycle change or deletion was attempted.

## Classed Lo-Fi release copies (PR #66)

At confirmed public release, the marked Lo-Fi keyframe, `loopraw.mp4` clip,
and `loopunit_*.mp4` loop unit each receive a create-only, SHA-256-verified
copy. The release observation transaction binds the exact source row/key/ETag,
destination key/ETag/LastModified, byte length, digest, class, release time,
and 30-day deadline in `r2AssetExpirations` with status `scheduled`. Replays
must match that receipt. The workbench and all three asset delivery routes
stop projecting or signing these classed copies at the encoded deadline.
Legacy rows, Nano Banana Pro thumbnails, reusable library media, and final
video copies are outside this 30-day class.

The daily worker reports scheduled copies only when the ledger, classed key,
source lineage, destination HEAD, metadata, and both release and upload age
match. It does not create deletion intents or delete scheduled copies. R2's
S3 and Workers APIs have no atomic ETag-conditional `DeleteObject` for this
path. A HEAD followed by delete cannot protect a changed object between the
requests. The separate account-wide writer audit and legacy inventory still
block live deletion; the account binding stays unset.

A provider-managed lifecycle rule is a possible future deletion path for
these exclusive classed copies. Cloudflare R2 lifecycle rules match a key
prefix from the **start** of the key and delete after upload age, usually
with delay. New keyframe, clip, and loop-unit copies now use
`released-ordinary/v2/owner/...`; final copies use
`released-final/v2/owner/...`. Their exact parsers and delivery ownership
checks require these root namespaces. A single exact, slash-terminated rule
per root prefix could eventually expire ordinary copies after 30 days and
final copies after 180 days. R2 uses upload age, while Studio's reader uses
the confirmed release deadline; a late upload can therefore become
unreadable before provider deletion. Before any live rule, inventory the
**actual** v2 prefixes and audit every credential and writer able to reach
them. The live inventory found no v1 release copies before this change; any
unexpected v1 object retains its exact encoded release deadline, is protected
from new writes, and requires separate reconciliation after expiry. Neither
root v2 namespace may be promoted directly to the permanent Studio Library
or reusable media inventory; a verified permanent copy is required. No
lifecycle rule was changed.
