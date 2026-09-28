# Legacy Studio R2 reconciliation

This is a read-only census for the pre-v2 key families. It does not migrate,
copy, expire, or delete any object. It never accesses the separate
`personal-travel-film-editor` bucket.

## Capture and plan

Run from this repository with a working Convex login and Studio R2 credentials.
The Studio app uses `astute-camel-689` for live data despite its historical
`dev:` label; the unused default production deployment is not the live app.
The Convex CLI currently writes a ZIP archive, so extract it before planning:

```sh
pnpm exec convex export --deployment astute-camel-689 --path /secure/studio-convex-snapshot.zip
mkdir -p /secure/studio-convex-snapshot
unzip -q /secure/studio-convex-snapshot.zip -d /secure/studio-convex-snapshot
pnpm exec tsx scripts/capture-studio-r2-inventory.ts /secure/studio-r2-inventory.jsonl
pnpm exec tsx scripts/plan-legacy-r2-retention.ts \
  /secure/studio-convex-snapshot /secure/studio-r2-inventory.jsonl \
  /secure/studio-legacy-retention-plan.json
```

Keep the snapshot and plan private: they contain production document data and
object keys. The inventory capture uses the exact `youtube-studio-ai` bucket,
requires complete key, ETag, size, and server timestamp data, and creates its
output file exclusively. A failed or truncated listing does not produce a
usable inventory. The planner requires a `documents.jsonl` file for every
table in the current schema and rejects duplicate or incomplete R2 records.
Run the export and inventory close together, then re-capture both before any
future action that could remove bytes.

The plan lists each object, its references throughout every application table
in the Convex snapshot (including historical tables outside the current schema),
and a reason. `review_unreferenced` is a **manual review queue**, never a
deletion grant. Only recognized generated media older than 30 days with zero
snapshot references can enter it. A Convex asset row counts as a reference,
even if its run is old. This intentionally favors retention when reachability
is ambiguous.

Recognized and possible finals remain preserved, including fixed-name run
masters: R2 age is not proof of public release date or YouTube destination
state. Thumbnail paths, Nano Banana thumbnails, reusable library paths,
evidence, and unknown prefixes also remain preserved. Their census still
appears in the plan so ownership can be resolved without guessing from names.

## Gate before any later cleanup

Review the live snapshot against the exact production deployment and check
release evidence, ownership, and external references for every proposed key.
Re-list and HEAD each exact object immediately before any separately reviewed
mutation, compare ETag and last-modified identity, and confirm no references
were added since the snapshot. There is no delete executor in this change.

## Read-only live census, 2026-09-28

The exact Studio bucket held 1,759 objects (203.47 GB decimal). The live
`astute-camel-689` snapshot contained 12,851 documents in 91 application
tables, including four historical tables outside the current schema. The plan
recorded 754 reference hits across 352 objects. Only 32 generated MP4s
(26.8 MB) entered manual review; this is a small review set, not an estimated
storage saving. Seven recognized finals were below 180 days, and 60 fixed-name
run masters were referenced. All remain preserved.

The 1,366 outside/unknown keys account for 186.42 GB. By filename and path
shape, 162.33 GB appears to be model mirrors, including currently active
manifests; 14.47 GB is compressed archives with unverified purpose; 8.07 GB
is video whose final status is unproven; about 0.27 GB has final/output-like
names; and the remainder is assorted files. These are descriptive groups,
not retention classes. Every one remains preserved until its manifest,
certificate, owner, and reference lineage is established.
