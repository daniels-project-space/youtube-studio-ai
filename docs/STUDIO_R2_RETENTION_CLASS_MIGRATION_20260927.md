# Studio R2 retention class migration checkpoint

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

The deletion path remains disabled by the independent
`YOUTUBE_STUDIO_R2_ACCOUNT_ID` binding. Do not enable the sweeper or R2
lifecycle rules yet. Remaining gates:

1. Inventory every legacy object and its live and historical pointers, then
   reconcile unknown keys and unregistered writers. The existing bucket has
   2,427 objects outside future class prefixes.
2. Remove or scope the four known account-wide R2 write tokens, audit unknown
   user tokens, and prove no writer can overwrite an expiry-managed key.
3. Move ordinary generated asset and final-video writers to separate
   release-time, create-only, digest-bound 30-day and 180-day key families.
   Bind the exact confirmed release instant and migrate all readers and
   certificates before any old key expires.
4. Audit promotions from every other library writer. Copy and verify bytes
   into a permanent key before rebinding an immutable library revision; keep
   historical revisions protected until their references are accounted for.
5. Exercise the full read, release, retention, lock, promotion, crash-recovery,
   and expiry path on a disposable scope before setting the deployment binding
   or any Cloudflare lifecycle rule.

This change performs no R2 deletion, lifecycle mutation, Trigger resume,
or paid render.
