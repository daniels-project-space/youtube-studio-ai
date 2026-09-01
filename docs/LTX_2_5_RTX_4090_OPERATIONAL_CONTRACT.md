# LTX 2.5 RTX 4090 operational contract

## Scope: self-hosted open weights, not an LTX API

Every LTX path in this repository runs the pinned open-weight LTX 2.5 runtime
inside our own Novita workers. This contract does **not** call, depend on, or
fall back to an LTX API or an external LTX Studio service. “Studio” elsewhere
in the product means our owner-scoped asset and control library.

The cinematic provider route has one video profile. It is intentionally
attestation-gated rather than best-effort:

- Runtime: `Lightricks/LTX-2@fd4ded7f2d88d3da713abcdd4ad41ecc4a9314ca`
- Weights: `Lightricks/LTX-2.5@ce298b1259d61ce6c87e05154b9ad339b16f32a0`
- GPU: exactly one RTX 4090 (24 GB)
- Execution: BF16 source weights, `fp8-cast`, CPU offload
- Video: 25 fps, eight distilled steps, final `1280×704`
- Upscale: LTX distilled stage one `640×352`, then its native latent x2
  spatial refinement to the final frame. This is not FFmpeg or Lanczos resize.

Confirmed 2026-08-17 — this `1280×704` native / `640×352` stage-one / x2
latent upscale configuration is the standing standard across all three
generation profiles (draft/production/hero); no per-style resolution
variants exist or are planned outside a new paid benchmark run.

## Frozen-opening root cause and release boundary

The upstream LTX ComfyUI maintainer traced the reported one-to-two-second
motionless opening to a VAE canvas that was not divisible by 32 (the reporter
had changed the sample workflow to `720×1280`). See
[ComfyUI-LTXVideo issue #384](https://github.com/Lightricks/ComfyUI-LTXVideo/issues/384).

This repository prevents that failure at two independent boundaries:

1. Generation-profile and direct-render admission require the `640×352`
   stage-one canvas to be divisible by 32 and its exact `1280×704` latent-x2
   output to be divisible by 64. A `720×1280` request fails before provider
   spend.
2. `qa_shots` decodes every returned take with FFmpeg `freezedetect` before
   subjective vision grading. The profile's `maxFreezeFraction` is enforced,
   an opening freeze is retained explicitly, and only a passing
   `ltx-shot-temporal-qa/v1` receipt can enter shot QA v1.1 and authorize
   assembly. Unavailable evidence fails closed; a measured freeze enters the
   bounded targeted-repair loop with its exact duration.

## Required cached component manifest

| ID | Relative model path | SHA-256 | Bytes |
| --- | --- | --- | ---: |
| `ltx-transformer` | `diffusion_models/ltx-2.5-22b-distilled-transformer-bf16.safetensors` | `31eb3cad89b9e54e99dd3baf286f70825ac4f6c660a70d9184d895be76d7bff4` | 42,018,190,584 |
| `ltx-text-encoder` | `text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors` | `1c647a94c0e902fb87f9a403cbca36a8b6d8e5867094442df1b41ae557cfd1c6` | 26,263,860,594 |
| `ltx-video-vae` | `vae/ltx-2.5-video-vae-bf16.safetensors` | `847e14ca7f3355debca0cea4eaa24ac0fbcdf0061da054ac89ca638a869ddba3` | 1,472,223,346 |
| `ltx-audio-vae` | `vae/ltx-2.5-audio-vae-bf16.safetensors` | `c52733d37f6a7fb7949c3dc0fb468c6cb2169e4d836983a73babb9f0d54837a5` | 364,866,540 |
| `ltx-spatial-upscaler` | `latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors` | `eb5a71fe4068ee87ccdb1c3aa635e547ca76bd2d30ae20ae889f2c325c0677e8` | 995,778,752 |

## Activation proof

Do not populate the profile benchmark allow-list until a controlled, paid
Novita run has all of the following evidence:

1. A digest-pinned worker image based on the runtime above and prewarmed in
   the selected cluster.
2. An R2 model manifest and persistent local cache containing every table row.
3. A completed sealed job on an actual RTX 4090, without OOM or fallback.
4. Worker completion evidence showing `fp8-cast`, CPU offload, stage-one
   `640×352`, x2 factor, and an `ffprobe`-observed `1280×704` MP4.
5. A sealed `ltx-benchmark-review/v2` pass with a
   `ltx-benchmark-review-evidence/v1` sidecar at
   `<benchmark-root>/review/evidence.json`. The sidecar must be immutable and
   hash-bound, name the exact output ID/key/SHA-256, bind a visual-review
   receipt, and contain passing retained-frame evidence for all four quality
   criteria: story/subject continuity, camera motion/temporal integrity,
   artifact freedom, and final image/audio fidelity. For the 0.68-second
   native-x2 proof, continuity requires three distinct retained frames across
   at least 0.5 seconds; every global criterion requires four across at least
   0.5 seconds. Clustered early frames cannot certify temporal quality.

The operator benchmark script creates `${benchmark-root}/review/brief.json`
before it seals the report. That brief is a **pending human review task**, not
evidence of quality: it binds the exact controller-observed output SHA and
lists the four mandatory criteria, but has no verdict, frames, or reviewer
receipt. The reviewer must create the separate immutable evidence sidecar
before the runtime can be admitted.

Until then, the runtime gate blocks before any worker create request. This is
intentional: static code compatibility is not a substitute for a real 24 GB
VRAM and output-quality proof.

The Studio health endpoint is intentionally informational when it runs on
Vercel. It must display **Not attested** until a `direct-trigger` health
attestation carries this exact profile identity, the native x2 flag, and the
RTX 4090 benchmark flag; a static health response can never enable rendering.

## Separate future route: LTX 2.5 audio-to-video for music visuals

Music-to-video is a distinct open-weight worker profile, not a new value for
the current `image`/`video` worker phase and not a prompt-level substitute.
LTX's `A2VidPipelineTwoStage` accepts a mastered audio source and optional
image conditioning; it preserves the input waveform while generating a
matching visual sequence. The current direct worker deliberately rejects an
`audio_video` manifest because it only pins the distilled image-to-video
bundle.

The application now has a provider-free, fail-closed handoff contract at
`src/engine/selfHostedLtxMusicVideoA2Vid.ts`. It binds a short sealed segment
of a mastered track, zero to two approved reference images, a dedicated
self-hosted Novita runtime, passing music-motion/reference/temporal benchmark
evidence, and one exact held spend reservation. It neither downloads an A2Vid
bundle nor enables the route; it exists so a future worker can be introduced
without accidentally treating the current distilled worker as capable.

Before this route can spend, all of the following must be sealed together:

1. A source-license acceptance record and an immutable model/runtime revision
   for the A2Vid-capable LTX bundle, including the exact full/compatible
   transformer and stage-two distilled LoRA files. No unpinned current-model
   file can be substituted for the existing worker's historical bundle.
2. A dedicated worker overlay that invokes the official
   `ltx_pipelines.a2vid_two_stage` path, never `ltx_pipelines.distilled` with
   an audio-looking prompt.
3. A SHA-256-bound mastered audio input, its duration/format probe, and zero,
   one, or two SHA-256-bound approved reference images. These are channel- and
   run-scoped inputs; no music, character, or visual reference may be borrowed
   from another channel.
4. A separately measured Novita GPU profile, hard budget reservation, output
   attestation, and retained visual/audio review. The choice of RTX 4090 or
   RTX 5090 follows the benchmark; an IC-LoRA control is never silently added
   to this standard A2Vid route.
5. Final-master evidence proving the output video, carried audio source, and
   reference-input fingerprints match the same sealed request before a Music
   Loop release can use it.

This keeps the existing Image-to-Video music-loop path usable only after its
own benchmark, while making the later A2Vid comparison honest: same mastered
track and approved references, separate cost/quality receipts, then choose the
better reviewed result rather than assuming the newer path wins.

## Standard LoRAs on this direct route

This worker supports **standard LoRAs only** through the native
`ltx_pipelines.distilled --lora` interface. A candidate is usable only after
its worker-manifest entry uses `ltx-creative-adapter/v3` and carries immutable
benchmark evidence for the exact rendered output, output hash/duration, and
the role-specific quality delta against a matched no-LoRA LTX baseline. The
adapted result must score at least 8/10 and improve materially; a generic
visual `pass` cannot approve an adapter.
visual-review receipt. A bare `passed: true`, a style name, or an unpinned
download is never sufficient.

Complementary standard-LoRA stacks use
`ltx-creative-adapter-stack/v2`: exactly two distinct, role-complementary
adapters, a combined strength strictly below `1.5`, and a separately retained
stack benchmark. The worker independently checks that both selected adapter
IDs and strengths exactly match that stack's calibrated benchmark entries. A
third LoRA, a reweighted pair, or a benchmark from individual adapters is not
valid evidence for the paid render.

Changing `infra/novita/worker.py`, any runtime/model pin, or the model cache
manifest invalidates the benchmark identity. Re-run the controlled benchmark
and review before adding a new allow-list entry; do not reuse an old pass for
an altered worker.

## Separate future route: ComfyUI IC-LoRAs and controls

Reference-sheet, pose, depth, edge, motion-track, Ingredients, and pixel
upscale IC-LoRAs are **not compatible with this 24 GB direct worker**. They
require a separately pinned ComfyUI/LTX worker with the exact node graph and
guide artifacts. The Studio contract requires at least **32 GB VRAM**, an
accepted source/license record, byte- and receipt-bound guide assets, a
sealed pre-spend reservation, and a dedicated output-quality benchmark before
it can be admitted.

That future route must remain separate from this benchmark allow-list. It is
not a fallback, and no IC-LoRA, ControlNet-like guide, or Comfy workflow may
be passed to the direct LTX worker by prompt or by adapter name.
