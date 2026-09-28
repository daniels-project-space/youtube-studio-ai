# YouTube Studio R2 asset retention

## Current scope

The two enabled R2 object-expiration rules match only keys beginning at the
bucket root with `released-ordinary/v2/` (30 days after upload) or
`released-final/v2/` (180 days after upload). They are not a general 30-day
cleanup of Studio assets or a general 180-day cleanup of every final video.
R2 evaluates each key prefix and upload age; it does not inspect Studio
metadata, Convex references, release time, or object purpose. Any object put
inside either reserved prefix will therefore match its rule.

The v2 writers place marked Lo-Fi keyframes, clips, and loop units under
`released-ordinary/v2/`, and certified final-master copies under
`released-final/v2/`. Studio separately checks each copy's encoded
`releaseAt + 30/180 days` deadline before serving it; R2's upload-age clock and
the reader's release-age clock are distinct. Reusable media uses permanent
library keys outside these prefixes, and the promotion fence rejects direct
promotion from either expiring namespace (`src/lib/r2AssetRetention.ts`,
`convex/r2ExpirationFence.ts`). Thus reusable media and other Studio objects
outside the two prefixes do not match these lifecycle rules. Keep the prefixes
reserved: an object written there by another writer still expires, regardless
of its metadata or references. See Cloudflare's [R2 object lifecycle
documentation](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

This prefix-based expiry is separate from the application sweeper. The daily
`r2-asset-retention-sweeper` reports due classed v2 copies but does not delete
them; its separate run cleanup path can delete only exact, certified run
objects after release, reference, owner, and account checks pass. The account
binding remains unset, so that application deletion path exits before
credentials, Convex, or R2 access. The older release-aware hourly worker
records completion without deleting R2 objects or asset metadata. The legacy
operator-triggered footage prune task is inventory-only
(`src/trigger/r2AssetRetentionSweeper.ts`,
`src/trigger/runArtifactRetentionSweeper.ts`).

The application deletion path separately handles a bounded set of
release-certified, run-scoped asset families and final masters. It requires
exact writer reservations, release evidence, reference checks, and other
fences. Fixed-name masters, unbound footage, older atlas crops without complete
derivative receipts, thumbnails, and unrelated intermediates do not become
eligible through age alone. This application path is distinct from the two R2
lifecycle rules, which apply to every object under their exact root prefixes.

The task requires the exact `youtube-studio-ai` bucket and an independently
configured `YOUTUBE_STUDIO_R2_ACCOUNT_ID` matching `R2_ACCOUNT_ID`. An explicit
`R2_ENDPOINT` must be the canonical endpoint for that account. The code also
pins the SHA-256 of the account ID verified by a read-only Cloudflare Get Bucket
request using the app vault's separate API token on 27 September 2026. The
deployment binding is still absent from current app configuration, so the
application deletion task logs a skip and returns before vault access, Convex
queries, or R2 calls. This binding does not disable the separately configured
R2 lifecycle rules for the two v2 prefixes.
With a binding present, the exact account and bucket assertions still fail
closed before listing or deleting if their identities differ.
No bucket-wide lifecycle rule is used because model/runtime weights and
reusable assets share this bucket. The two enabled lifecycle rules below are
limited to the classed-release v2 root prefixes.

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
broader 30/180-day asset policy cannot be expressed as a bucket-wide lifecycle rule in this
mixed bucket. Keep the production Trigger environment and queues paused while
Studio is not ready. No lifecycle change or deletion was attempted during
the 27 September inspection; see the live v2 rules recorded below.

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

Cloudflare R2 lifecycle rules match a key prefix from the **start** of the
key and delete after upload age, with no exact deletion deadline. New
keyframe, clip, and loop-unit copies use
`released-ordinary/v2/owner/...`; final copies use
`released-final/v2/owner/...`. Their exact parsers and delivery ownership
checks require these root namespaces. R2 uses upload age, while Studio's reader uses
the confirmed release deadline; a late upload can therefore become
unreadable before provider deletion. The live inventory found no v1 release
copies before this change; any
unexpected v1 object retains its exact encoded release deadline, is protected
from new writes, and requires separate reconciliation after expiry. Neither
root v2 namespace may be promoted directly to the permanent Studio Library
or reusable media inventory; a verified permanent copy is required.

### Live R2 lifecycle state, 28 September 2026

The `youtube-studio-ai` bucket now has exactly three enabled rules. Read-only
S3 `GetBucketLifecycleConfiguration` confirmed these exact IDs and scopes:

| Rule ID | Exact prefix | Action |
| --- | --- | --- |
| `Default Multipart Abort Rule` | Bucket default | Abort incomplete multipart uploads after 7 days |
| `Released Ordinary v2 Expiration 30 Days` | `released-ordinary/v2/` | Expire objects 30 days after upload |
| `Released Final v2 Expiration 180 Days` | `released-final/v2/` | Expire objects 180 days after upload |

Before applying the rules, both exact v2 prefixes were empty. A disposable
`codex-probes/r2-lifecycle/<uuid>/sentinel.txt` test showed S3 rule readback,
a successful object HEAD with `x-amz-expiration`, and rollback to the exact
baseline with an empty probe prefix. The probe did **not** wait for or prove
actual age-based deletion. The installer then verified the exact three-rule
configuration by S3 GET. No probe object remains.

The slash-terminated v2 prefixes exclude nested v1 copies, reusable library
objects, thumbnails, and legacy keys. The lifecycle rules are prefix-wide and
will expire any object written into either reserved namespace, including an
object from another writer. Account-wide R2 write tokens still exist, so
prefix exclusivity is an operational contract, not a credential-enforced
boundary. R2 expiration may lag eligibility by roughly 24 hours or more, while
Studio's reader applies the release-based deadline.
PR #66 production code remains undeployed and Trigger tasks remain paused; no Studio deploy,
render, publish, or live media deletion was performed with this change.
