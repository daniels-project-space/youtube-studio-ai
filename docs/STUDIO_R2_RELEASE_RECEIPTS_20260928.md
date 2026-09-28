# Studio R2 release receipts (review draft)

Base: production source `e788a3e`. This change does not deploy or enable a
Trigger schedule, R2 sweeper, Cloudflare lifecycle rule, or deletion route.

## Exact eligible writers

The existing intro-card block, Novita storyboard-atlas crop materializer, and
Quiz Year/Quiz Short final writer now reserve an owned run key in Convex before
uploading. Their keys include a full SHA-256 digest. R2 uploads are create-only,
and the writer verifies full stored bytes before closing the reservation.
Legacy fixed-name keys remain readable and outside this classification.

The shared storage API rejects overwriteable uploads to those key families.
The existing private asset routes retain owner checks and deadline checks for
previously introduced v1/v2 release-copy keys. They do not expose new public
media.

## Release clock and exclusions

The existing `recordReleaseObservations` mutation runs only after an exact
YouTube video and channel are observed public and processed. For finished
reservations in that same owned run it writes immutable, idempotent receipts:

| Writer | Retain until |
| --- | --- |
| `intro-card/v1`, `atlas-crop/v1` | public release + 30 days |
| `quiz-final/v1` | public release + 180 days |

The parser excludes thumbnails, reusable libraries, travel media, legacy key
shapes, and unknown objects. Every revision referenced by Studio's asset
library or reusable-media table is excluded. The receipt captures the exact
R2 ETag, last-modified time, byte length, release time, and deadline. It is
evidence of the retention clock, never deletion authority.

## Deliberately held transition

The original certified final is still read for QA and thumbnail lineage.
Neither it nor historical assets can be expired safely yet. The existing run
cleanup path now seals certificate evidence without deleting R2 keys or asset
rows, even when manually invoked. No R2 asset sweeper is included in this PR.

Deploying the writer requires the new Convex schema and functions to be live
before the Trigger workers or web readers use them. Keep
`STUDIO_SCHEDULES_ENABLED` false and the R2 sweeper disabled. A later,
separately reviewed release must prove final-reader migration, full legacy
reference inventory, writer token scope, and disposable-scope expiry before
any deletion or lifecycle rule is enabled.
