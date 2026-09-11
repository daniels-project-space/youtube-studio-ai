# Lo-Fi native thumbnail edit review — September 2026

## Scope

The Lo-Fi thumbnail side lane now sends the exact normalized frame sampled at
15 seconds to Fal Nano Banana as the sole image input. Nano Banana renders the
single `4K` emblem itself. The local chroma-matte and FFmpeg typography
compositor are retired from this route; FFmpeg remains only where the video
frame must be sampled and normalized.

## Contract and evidence

- Contract: `fal-nano-banana-lofi-thumbnail/v2`.
- Evidence: `thumbnail-lofi-fal-nano-banana-evidence/v2`, mode
  `lofi-render-frame-native`.
- The request body contains exactly one `image_urls` entry bound to the
  15-second frame hash. A native provider result is required to be a bounded
  16:9 raster and carries the same frame hash in its receipt.
- The preservation gate still measures the non-emblem regions against the
  exact frame and rejects a provider result below the `0.995` SSIM threshold.
- Historical v1 matte-based receipts remain readable for audit/recovery, but
  the active block will not reuse them for a new request. The changed contract
  version also prevents a stale paid request hash from being mistaken for the
  native route.
- Checkpoint uploads now derive the stored MIME type from valid raster bytes,
  while preserving compatibility with older local-only sentinel fixtures.

## Verification

The focused contract, adapter, checkpoint, and wiring tests pass, including a
new v2 checkpoint fixture and a source assertion that rejects the old local
compositor. Typecheck, changed-file ESLint, and `git diff --check` pass. No
paid provider call or production thumbnail mutation was made in this slice;
real-output visual qualification remains a separate owner-authorized step.
