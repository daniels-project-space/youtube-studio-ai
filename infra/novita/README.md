# Novita render worker v2

This directory is the immutable GPU data plane for YouTube Studio. The TypeScript
control-plane contract lives in `src/lib/novitaFleet.ts`; `novitaRenderFarm.ts`
performs its authenticated zero-cost readiness check before every paid launch.

## Runtime contract

- One independent RTX 4090 spot instance per worker; hard fleet limit eight.
- The default verified account quota is three. Eight is enabled only after the
  account quota is explicitly verified; inventory-aware waves can reduce this
  further without changing model quality.
- Z-Image Turbo is loaded from the local SSD cache at
  `/workspace/model-cache`, hydrated from the existing `ai-infra-models`
  network volume. Every file/tree manifest is SHA-256 verified.
- Video uses official LTX-2.5 at a pinned Hugging Face revision and official
  Lightricks runtime commit. Its one permitted RTX 4090 profile uses the
  distilled two-stage pipeline: `640×352 → 1280×704` through LTX's native
  latent-space x2 refinement, not a post-render resize.
- The worker requires all five exact split components from the persistent model
  manifest: transformer, Gemma 4 text encoder, video VAE, audio VAE, and x2
  spatial upscaler. Each has a pinned repository/revision, SHA-256, byte count,
  source path, and local-cache path. The local Gemma 4 encoder is a model file,
  not a Gemini API call.
- FP8-cast quantization and CPU offload are part of the signed video profile;
  they cannot be omitted, substituted, or silently changed by the worker.
  Each profile accepts only 1280×704, 25 fps, eight-step distilled generation,
  and the pinned x2 component set.
- Before upload, `ffprobe` must observe an encoded 1280×704 video stream. The
  worker preserves per-shot x2 geometry/execution evidence in checkpoints and
  completion data; the controller rejects a clip without it.
- The worker receives one presigned manifest URL and object-scoped input/output
  URLs. It never receives Novita or R2 account credentials.
- Delivery URLs and R2 metadata are validated before GPU inference. Artifact
  ownership is bound to the stable manifest ID, profile hash, and job ID; using
  the full manifest hash here would create a circular hash because presigned
  URLs are themselves inside the manifest.
- A heartbeat starts before checkpoint loading and local model hydration. A
  checkpoint is written after each uploaded shot, and status is batched to one
  heartbeat per minute. No frame-level Convex or Trigger writes occur.
- Large model copies and artifact PUTs stream instead of loading whole files in
  memory. Local tree-cache hits are content-hashed, not trusted by size alone.
- Workers exit after their assigned shard. The control plane must stop, delete,
  and poll until the instance is confirmed removed. A five-minute idle reaper
  is required by readiness admission.

## Immutable image

Build from the repository root:

```bash
docker build -f infra/novita/Dockerfile -t <registry>/youtube-render-worker:<git-sha> .
```

The repository-root `.dockerignore` is a default-deny allowlist for this exact
command: only `infra/novita/Dockerfile` and `infra/novita/worker.py` enter the
context. Environment files, Git history, `graphify-out`, dependencies, Python
bytecode, tests, and source media are excluded.

Push the image, resolve its registry digest, configure Novita registry auth,
and prewarm that exact digest in the network-volume cluster. Tags are never
accepted by dispatch; the provider request must use `image@sha256:<digest>`.

## Current activation gate

The worker code is deployable, but dispatch intentionally remains blocked until
all v2 readiness fields pass. In particular, registry auth/image digest,
prewarm state, a regenerated R2/persistent-volume manifest containing the five
LTX-2.5 component files, bridge v2 attestation, spend caps, verified
deletion/reaper controls, and one controlled **exact-profile RTX 4090**
benchmark must exist. The benchmark must prove no OOM and produce the
ffprobe-verified 1280×704 result. The readiness check is read-only and must
pass before the first GPU create call.

The current eight-GPU contract means up to eight independent one-GPU RTX 4090
workers rendering shots in parallel. It is not a single distributed eight-GPU
LTX invocation. Provider-billed spend enforcement, atomic fleet admission,
artifact/checkpoint reconciliation after a hard process kill, and verified pod
deletion remain bridge/control-plane responsibilities and must be proven live
before activation.

No model download, public bootstrap script, provider fallback, paid render, or
publishing action is part of this directory's validation path.

## Dedicated A2Vid worker (sealed benchmark only)

`Dockerfile.a2vid` and `a2vid_worker.py` are a separate self-hosted,
open-weight LTX 2.5 audio-to-video path for Novita. They are not an LTX API
integration and they do not alter the established image-to-video worker.

- The build accepts **no default LTX runtime revision**. It must be supplied
  after the LTX model terms are accepted and the exact source commit is pinned.
- The one-job `audio_video` manifest binds a 2–20 second mastered-audio window,
  optional approved opening/ending stills, six hash-checked A2Vid components,
  a single exact GPU SKU, cost/lifetime cap, and R2 delivery metadata.
- It invokes only the official `ltx_pipelines.a2vid_two_stage` CLI. A direct
  `ltx_pipelines.distilled` image-to-video job cannot be re-labelled as A2Vid.
- The initial profile is benchmark-only: 1280×704, 25 fps, eight steps, native
  two-stage 640×352 → 1280×704. It may run on a sealed RTX 4090 or RTX 5090;
  ComfyUI IC-LoRA work remains a different **RTX 5090 / 32 GB+** worker route.
- Its result must pass the matched A/B quality admission in
  `src/engine/selfHostedLtxMusicVideoA2Vid.ts` before a Music Video pipeline
  may consider it. Building this image alone does not enable dispatch.

Build only after recording the accepted immutable runtime revision and model
component manifest; never use a moving branch or the direct worker's pinned
revision as a substitute:

```bash
docker build --build-arg LTX_RUNTIME_REVISION=<accepted-40-hex-commit> \
  -f infra/novita/Dockerfile.a2vid -t <registry>/youtube-ltx-a2vid:<pin> .
```
