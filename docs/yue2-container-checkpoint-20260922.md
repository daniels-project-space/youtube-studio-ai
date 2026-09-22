# Studio music container checkpoint: 2026-09-22

## Built And Verified

- Runtime revision: `c5d5a6b61107ad08bc22a20f7813d0e57137e73f`.
- Studio build-tool revision: `1a81fe181ba98d58d389c33c093d4936dcef3145`.
- Immutable image: `sha256:ac156cab80cb0e0eeb0cae37f67d8323f48afe7e0655eba3185d3b238269bb04`.
- Image labels identify `youtube-studio-ai`, `yue2-rtx3090`, and the exact
  runtime revision. The build used clean, separate detached project worktrees.
- Official source/package integrity, actual `YuE2Pipeline` import and Torch
  CUDA 12.8 checks passed. Native precision and quality settings are unchanged.
- Both installed vendored ABC parser notices match their pinned source hashes.
  The Docker default-deny allowlist had excluded these files even though the
  project build context copied them. The runtime now explicitly includes them
  and checks their installation; the Studio builder verifies their hashes.
- All five retained model/config/tokenizer files, totaling 7,794,517,915 bytes,
  matched the pinned hashes with networking disabled and the model volume
  mounted read-only. No weights were redownloaded for this verification.
- All 145 runtime tests passed inside the image, with zero skips. This includes
  the six decoder cases skipped by the lightweight Python environment.
  Decoder checks use real pinned Torch/YuE2 code on CPU and a synthetic VAE;
  they do not render music or establish GPU fit or perceptual quality.
- The container test run had no network, a read-only root and test worktree,
  no added capabilities, no GPU, two CPUs, 4 GiB RAM and a 512 MiB temporary
  filesystem. Test inference backends remain explicitly synthetic.
- Ten project-build/worktree isolation tests passed. Both graphs were refreshed.

## Retained Evidence

Build root:
`/var/lib/youtube-studio-render/builds/yue2-c5d5a6b61107ad08bc22a20f7813d0e57137e73f/`

- `context-xUXxe7.json`: exact app/runtime revisions, image identity, installed
  notice hashes, source context and separate model/state volumes.
- `context-xUXxe7.cache.json`: offline verification of every pinned model file.
- `build.log`: actual Docker build and verification output.
- `container-tests.log`: all 145 test results and terminal success.

Rebuild with `node scripts/studio-yue2-build.mjs build-and-verify-cache` from a
clean committed Studio checkout. The script pins the runtime revision above;
it does not use another project's image, environment, model cache or job ledger.

## Still Not Live

No GPU VM was started, remote image changed, execution-policy binding changed,
music generated, thumbnail tested, or publishing enabled. The dedicated vault
credential's fingerprint was unchanged from the previously revoked key; no
new request using that key was sent to OpenRelay. A replacement dedicated key
and a separately admitted GPU window remain necessary for live qualification.

The image is a verified local build, not a remote deployment. New source policy
support still needs a matching remote image and supervised execution binding.
Actual music, channel fit, instrumental leakage, ending/repetition quality,
and owner-approved continuation remain separate release requirements.
