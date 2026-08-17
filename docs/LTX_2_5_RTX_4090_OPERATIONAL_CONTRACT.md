# LTX 2.5 RTX 4090 operational contract

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
5. Visual review and audio/continuity QA of the resulting clip.

Until then, the runtime gate blocks before any worker create request. This is
intentional: static code compatibility is not a substitute for a real 24 GB
VRAM and output-quality proof.

The Studio health endpoint is intentionally informational when it runs on
Vercel. It must display **Not attested** until a `direct-trigger` health
attestation carries this exact profile identity, the native x2 flag, and the
RTX 4090 benchmark flag; a static health response can never enable rendering.
