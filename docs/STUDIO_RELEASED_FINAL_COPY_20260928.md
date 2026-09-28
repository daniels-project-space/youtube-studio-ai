# Certified final release copy (draft, no activation)

Base: draft receipt PR #70 head `23c8cc0f`. No deployment, deletion, Cloudflare
lifecycle rule, or Studio schedule change is included.

## Exact path

The existing `videos.list` observer admits only the saved video ID and channel,
`public` privacy, `processed` upload status, and a valid public `publishedAt`.
`recordReleaseObservations` stores that clock. The existing retention sweeper
then asks `releasedFinalMasters.candidate` for a fresh pending observation and
uses a separate six-hour copy retry index. `begin` independently checks the
fresh observation, owner, channel lock, run, certificate key, release generation,
and exact `released-final/v2` digest key before any R2 write.

The worker parses the original certificate and validates its scoped object
keys. It HEADs and streams the certified master with `If-Match`, checks the
whole file SHA-256 and byte length against the certificate, and verifies that
the source ETag, last-modified time, and length stayed fixed. It writes the
release copy with create-only `If-None-Match: *`, source/certificate/release
metadata, then streams the entire stored copy to verify its SHA-256 and length
before closing an immutable source-to-copy generation ledger. An existing
copy on replay must pass the same byte and metadata checks. This accepts both
`runs/<run>/final.mp4` and certificate-bound quiz final keys without a path
shortcut. The original master, its asset row, publish intent, certificate,
thumbnail source identity, and all QA evidence remain unchanged.

## Held boundaries

- The global `STUDIO_SCHEDULES_ENABLED` switch also controls unrelated work.
  Keep it paused. A later release needs a separate guarded maintenance
  schedule/controller and a tested production observation-to-copy run.
- No playback reader switches to the copy yet. `convex/videos.ts` returns the
  certificate's original key and passes it into Lo-Fi thumbnail evidence
  selection. Replacing that one value would reject reviewed source-frame
  thumbnails. The publish intent and certificate verifiers also require the
  original key. A future projection needs distinct source identity and
  playback key fields, with verified generation selection and expiry state.
- A run can reach completed 14-day cleanup while a copy is still blocked;
  that cleanup currently seals evidence and removes zero objects. Before
  activating any expiry, the later controller must continue release checks
  across completed runs and handle later public-release generations. It must
  not infer a new clock from an old receipt.
- The copy uses worker-local temporary storage equal to the master size and
  reads the full source and copy. Qualify available worker disk and actual
  large multipart R2 behavior before activation. No media was copied here.
- The source master and its evidence stay protected. No v1 or legacy object
  acquires deletion authority from this ledger. Ordinary 30-day policy remains
  the separate receipt family from PR #70; this draft adds only final copies.

## Verification

Focused release-ledger tests exercise the real Convex observation, candidate,
reservation and finish handlers for a `final.mp4` and quiz final source,
including private observations and conflicting source identity. Full TypeScript
typecheck passed in the sparse checkout with read-only links to omitted source
directories. No production build or live R2 transfer was run because the
workspace disk had under 50 MB free.
