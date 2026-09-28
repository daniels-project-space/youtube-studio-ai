# Legacy Studio R2 reconciliation

This is a read-only census for the pre-v2 key families. It does not migrate,
copy, expire, or delete any object. It never accesses the separate
`personal-travel-film-editor` bucket.

## Capture and plan

Run from this repository with a working Convex login and Studio R2 credentials:

```sh
pnpm exec convex export --prod --path /secure/studio-convex-snapshot/
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

The plan lists each object, its references throughout the Convex snapshot,
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
