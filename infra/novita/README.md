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
- Video uses official LTX-2.3 weights at the pinned Hugging Face revision and
  official Lightricks runtime commit. Production and hero profiles use the
  official two-stage HQ pipeline, distilled LoRA, and x2 spatial upscaler.
- The text encoder tree must identify the exact, 40-character pinned revision
  of Lightricks' documented `google/gemma-3-12b-it-qat-q4_0-unquantized`
  repository, and readiness must attest that same local cache.
- Draft video uses the official distilled entry point and distilled checkpoint.
  Each phase accepts only the three exact approved draft/production/hero
  profiles; dimensions, steps, guidance, BF16 precision, FPS, checkpoint names,
  and pipeline choice cannot drift inside a self-signed manifest.
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
prewarm state, staged model manifests, bridge v2 attestation, spend caps, and
verified deletion/reaper controls must exist. The readiness check is read-only
and must pass before the first GPU create call.

The current eight-GPU contract means up to eight independent one-GPU RTX 4090
workers rendering shots in parallel. It is not a single distributed eight-GPU
LTX invocation. Provider-billed spend enforcement, atomic fleet admission,
artifact/checkpoint reconciliation after a hard process kill, and verified pod
deletion remain bridge/control-plane responsibilities and must be proven live
before activation.

No model download, public bootstrap script, provider fallback, paid render, or
publishing action is part of this directory's validation path.
