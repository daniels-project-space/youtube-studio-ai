# Weekly Salad bulk wiring audit — 9 September 2026

## Result and scope

Reuse the existing R2 model packs and ERNIE image. The missing production layer is a durable cross-channel job/controller contract, verified worker adapters, and adoption of prepared results by the scheduled runner. Model-file presence is not proof that those paths can render or recover correctly.

The live preflight completed at **2026-09-09T01:38:04.548Z**. This audit used Graphify, current source/callers, recent Git history, relevant infrastructure/vault memory, the Cloudflare/R2 skill, and read-only provider checks. No GPU was created, started, resized, stopped or deleted; no inference, upload, publication, credential mutation or production write occurred. This document is the only repository change from this audit follow-up. The existing 151-item ledger remains authoritative; this does not replace earlier requirements.

Current application history was headed by `94ee38e` (`Use verified combined run media subscription`); the recent commits concerned run-media projection, retained title inputs and durable stage charges, not a new Salad dispatcher. The separate runtime repository `/home/ubuntu/salad-media-infra` had HEAD `ae48ea5` and substantial existing uncommitted route/hydration work. Those changes were inspected and preserved, not treated as deployed images.

## Fresh R2 inventory

Bucket: **`salad-render-infra`**. The existing [read-only preflight](../scripts/salad-runtime-preflight.ts) downloaded each small manifest, verified the SHA-256 of its exact bytes, and matched every declared model object's key and byte length against an untruncated listing.

| Route | Immutable manifest key | Manifest SHA-256 | Files / total bytes |
| --- | --- | --- | --- |
| ERNIE SFT / 3090 | `ernie-image-sft-v1/immutable-manifest.json` | `4147d735ed0663a83460034da391f5a4c081aefef44ef2f37ad7163f7e275637` | 4 / 30,998,316,546 |
| Music3 BF16 / 3090 | `minimax-music3-bf16-v1/immutable-manifest.json` | `fde881bc3a6fe11fecb6c2211967038093766f9db2ca0c07e89e846117e1c32a` | 88 / 57,353,379,600 |
| H3 Turbo8 / desktop 5090 | `minimax-h3-turbo8-5090-v1/immutable-manifest.json` | `eca7ade81afd2edd4b912275a8657b9504cab71ca7e538aed7ce12f27acc90c9` | 5 / 44,426,778,471 |

**Verification boundary:** all 97 model objects were present with exact declared sizes. Their full contents were not downloaded/rehashed during this audit. The existing `salad-media-infra/common/hydrate.py:68` verifies individual hashes after hydration; that remains mandatory before inference.

The resolved identities remain those recorded in [the 8 September inventory](SALAD_R2_RUNTIME_INVENTORY_2026-09.md): ERNIE `Comfy-Org/ERNIE-Image` revision `01bcb3f1acdb1454ee579d2796ecc4c156873eea`; H3 `Comfy-Org/MiniMax-H3` revision `4cc1d817b6184899b41293954329f576cb5ae86b`; Music3 `MiniMaxAI/MiniMax-Music3` revision `fbdf52fbaaca799592917417eb05f1899f1255ec`. H3 is the retained FL2VA INT8 ConvRot plus official eight-step Turbo LoRA route, not the old Hailuo API or an LTX replacement.

Bounded listings also confirmed the ComfyUI runtime prefixes `worker-runtime/comfyui/{3ac5d7941dfa2504555260512132d1cb5664648d,72865f4f27eaf5396f8f36370e0a2be3a9a090ee,e20d433a4966dcc88fa5abbae6ace824cb78b263}/` and the historical `worker-bootstrap/novita-shared-workers/20260829-v100/` prefix. Prefix presence alone does not qualify those archives or bind them to the current source.

### Bounded Qwen finding

No Qwen3-TTS model pack or Salad worker image was located in the checked Salad model/runtime/bootstrap prefixes or the checked YouTube `models/`, `novita/model-manifests/`, `novita/runtime/`, `novita/code/`, and `aiinfra/weights/` inventories. This is **not** a claim that Qwen TTS is absent from every R2 bucket, nested prefix, registry repository, or vault service. Music3's Qwen language-model weights are not Qwen TTS.

The existing [Qwen worker](../workers/qwen3-tts/worker.py) at line 79 instead loads `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` directly from its pinned HF revision `0c0e3051f131929182e2c023b9537f8b1c68adfe`. Its [application receipt](../src/lib/qwenTts.ts) at lines 61 and 129 requires Novita RTX 4090/serverless/persistent-cache attestation. A Salad 3090 implementation must earn its own compatible, full-quality receipt; changing a provider label is not a migration.

## Vault, registry and live GPU scope

Only logical credential names are recorded:

| Vault service | Existing logical names checked | Evidence |
| --- | --- | --- |
| `salad` | `SALAD_API_KEY`, `SALAD_ORG`, `SALAD_PROJECT`, legacy `SALAD_LTX_*`, `SALAD_R2_*` | Authenticated scoped provider reads succeeded. |
| `cloudflare` | `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Manifest GETs and bounded object listings succeeded. |
| `github` | `GHCR_USERNAME`, `GHCR_SALAD_PULL_TOKEN` | Authenticated registry pull-scope token and manifest HEAD succeeded. |
| `novita` | `NOVITA_API_KEY` | Name inventory only; no GPU/provider mutation. |

The operator vault bridge injected values only into the read-only child process. This does not establish that a production Trigger service identity currently has the same vault permissions. No Qwen/Music worker endpoint/token was present in the checked local environment; no exhaustive vault or production environment inventory was performed. Required application names remain `QWEN3_TTS_WORKER_URL` / `QWEN3_TTS_WORKER_TOKEN` and `MINIMAX_MUSIC3_WORKER_URL` / `MINIMAX_MUSIC3_WORKER_TOKEN`, with their separate qualification gates.

Remote GHCR HEAD returned **200**, a 3,467-byte manifest, and the exact requested digest:

`ghcr.io/danielmabro-new/salad-media-infra@sha256:bce44326b54d698004f90ce03b77f45a9dcd4bff13aa88b4ec36aeabe77f25d0`

The complete tags listing for that repository contained only `ernie-20260902-compact`. Thus ERNIE registry authorization and remote manifest existence are newly verified; current source-to-image mapping, layer hydration, inference and quality are not. No `SALAD_ERNIE_WORKER_IMAGE`, `SALAD_MUSIC3_WORKER_IMAGE`, or `SALAD_H3_WORKER_IMAGE` digest was configured in the preflight process/checked Salad namespace.

Live scope was organization `bananajoeinc`, project `default`: **0 occupied GPU slots**, organization quota **10**, reported used **0**.

| Exact class | Live class UUID | Medium USD/hour | Matching availability |
| --- | --- | --- | --- |
| RTX 3090 (24 GB) | `a5db5c50-cbcb-4596-ae80-6a0c8090d80f` | 0.197 | ERNIE: 106; Music3: 18 |
| RTX 5090 (32 GB), desktop | `851399fb-7329-4195-a042-d6514b28cf33` | 0.380 | H3: 0 |

ERNIE resources: 4 CPU, 32,768 MB RAM, 48 GiB disk. Music3: 8 CPU, 65,536 MB RAM, 80 GiB disk. H3: 8 CPU, 131,072 MB RAM, 100 GiB disk, existing `country_codes: ["cn"]` restriction. **The H3 zero is specific to that complete filter, not global 5090 unavailability.** Preserve the existing restriction until its recorded license scope is separately verified; do not relax it merely to obtain capacity. Availability is an estimate, not a reservation, and must be refreshed before admission. [Official preflight guidance](https://docs.salad.com/agents/container-engine/discover-scope-and-preflight)

## Wired behavior versus missing integration

| Surface | Actual current behavior | Remaining integration |
| --- | --- | --- |
| Salad API client | [saladCloud.ts](../src/lib/saladCloud.ts):116 selects exact desktop classes; 154 builds medium-priority, digest-pinned requests; 131 counts allocating/stopping capacity conservatively. | Its only non-test importer found under application source/scripts was the preflight script. No production dispatch/controller caller or transactional fleet-wide lease was found. A per-group maximum of three is not a fleet-wide three-GPU guarantee. |
| Weekly planner | [planWeekPreparation.ts](../src/lib/planWeekPreparation.ts):15 freezes editorial inputs, module config and handoff prompts. [runPipeline.ts](../src/trigger/runPipeline.ts):1745 adopts that immutable packet; [narratedBlocks.ts](../src/trigger/blocks/narratedBlocks.ts):677 consumes its script brief. | This is not a completed cross-channel media order. No accepted TTS/music/H3/image batch-result contract is consumed through this handoff. Normal later stages still need to execute. |
| ERNIE worker | `salad-media-infra/routes/ernie/server.py:135` accepts prompt/seed and one presigned output URL, renders native 1024-square/50-step/CFG4 artwork, PUTs PNG, returns a checksum receipt. | No durable job identity/deduplication/replay endpoint; no arbitrary 16:9 contract. Models unload after each job, limiting warm-batch efficiency. |
| H3 worker | `salad-media-infra/routes/h3/server.py:41` accepts the exact first-frame hash and native Turbo8 profile, returning a receipt after output. | No proven durable job recovery or production adapter. The 4K/latent proof profile remains disabled, not a qualified output route. |
| Music3 worker | `salad-media-infra/routes/music3/server.py:30` loads the full BF16 pipeline onto CUDA; its endpoint returns native WAV. | Single-3090 memory fit is unproven; startup can fail before readiness. No durable R2 receipt. [minimaxMusic3.ts](../src/lib/minimaxMusic3.ts):21 instead requires two Novita 4090s and a different runtime/output/quality receipt. Do not silently quantize, offload, or relabel to make it pass. |
| Release retention | [runArtifactRetention.ts](../src/lib/runArtifactRetention.ts):24 waits for confirmed public release before starting fourteen days. The cleanup block in [lofiBlocks.ts](../src/trigger/blocks/lofiBlocks.ts):3513 persists that schedule. [runArtifactRetentionSweeper.ts](../src/trigger/runArtifactRetentionSweeper.ts):263 runs hourly. | [runArtifactPrune.ts](../src/lib/runArtifactPrune.ts):54 only lists the exact `runs/{runId}/` namespace. `plan-batches/...` bulk outputs need explicit adoption/ownership and retention linkage. Current keep policy includes final export, thumbnail and compact release evidence; it is not blanket deletion of every non-video object. |

The existing worker endpoints are real single-job adapters, not native Salad queue `/process` consumers. Before queue redelivery or Novita fallback is enabled, the controller must reconcile the immutable request and durable output rather than treat an interrupted HTTP response as permission to pay again. Queue retry behavior is documented separately by Salad. [Queue guide](https://docs.salad.com/container-engine/how-to-guides/job-processing/using-queues)

### Teardown proof is incomplete

`salad-media-infra/salad/proof_runner.py:426` requests scale-zero, stop and delete in `finally`, but never polls actual instances to zero. At line 449 its final success derives from artifact presence even if shutdown requests failed. Do not reuse that success flag as evidence that billing ended.

The application already has a stricter group-plus-instances predicate, [isSaladGroupStopped](../src/lib/saladCloud.ts) at line 148, but no live controller uses it. Capacity leases must remain held through stopping, and a durable sweeper must finish teardown after a controller crash. Salad explicitly notes that individual instances can remain running after the group is reported stopped. [Deployment lifecycle](https://docs.salad.com/container-engine/explanation/container-groups/deployment-lifecycle)

## Evidence retention and next bounded target

The fresh preflight JSON, R2 listings, registry HEAD and tag-list results were returned to the audit task's tool history. No separate local JSON receipt or new R2 evidence object was written, and no runtime qualification receipt was manufactured. Reproduce the inventory with the existing `scripts/salad-runtime-preflight.ts`, injecting the logical Salad and Cloudflare credentials through `ai-vault`; the script performs no lifecycle mutation.

Historical receipt pointer from the 8 September inventory, **not freshly fetched during this audit**:

`r2://salad-render-infra/salad-media-tests/20260902/ernie-medium-parallel-hydration-79568c89219d499ba4b1f395e0d32521/report.json`

That inventory records `success: false`, `artifact: null`, and 1,500.514 seconds elapsed. It is cold-start/hydration failure evidence, not a Golden quality receipt.

Next implementation slice: add one owner/week immutable job ledger and provider-specific prepared-result adapters around the existing runtime packs. Bind every job to channel/episode, source/config hashes, worker digest, exact GPU/priority, output namespace and cost authority. Add shared three-GPU leases, fenced claims, accepted-result reuse, and durable shutdown recovery; then wire the scheduled runner to consume verified assets without regenerating them. Start with the existing ERNIE image/pack, retaining all paid-dispatch holds until a bounded real 3090 hydration/output-quality/interruption/shutdown proof succeeds. Resolve Music3 residency, Qwen pack provenance and the restricted H3 route independently; do not manufacture compatibility by changing their receipt labels.

This is a concrete backend implementation target and route-specific qualification work, not a global goal blocker. No legacy path should be removed before its replacement demonstrates actual caller/output/recovery parity.

## Music3 residency follow-up — header-only evidence

**Correction to the possible inference from the 57.4 GB pack size:** it is not the worker's resident GPU footprint and does not prove that full-BF16 Music3 cannot run on a 3090. The pack contains both legacy `qwen_7B/` / `.pth` checkpoints and the converted Diffusers components. Its checksum-verified `modular_model_index.json` (SHA-256 `1dc86609cf8855e70cc3f5d085213988094fb59e448aedcda06740d34e386002`) declares five tensor-bearing components, plus tokenizer and scheduler. The nine converted safetensors shards below are the relevant set; legacy copies were not added to the residency estimate.

At **2026-09-09T01:59:15.454Z**, the audit completed **18 exact HTTP 206 Range GETs, totaling 112,128 bytes**, covering only the eight-byte length prefix and JSON header of each of those nine shards. Each response had the requested range/length and expected total object size. Tensor shapes, dtype widths, offsets, complete non-overlapping payload coverage and cross-shard name uniqueness were checked. No tensor payload was read, no model was loaded, and no GPU/inference call occurred. This follows the documented safetensors header layout. [Official format](https://github.com/safetensors/safetensors#format)

| Loaded component | Shards / tensors | Stored dtype | Tensor elements | Stored tensor bytes | BF16-equivalent bytes |
| --- | --- | --- | ---: | ---: | ---: |
| `condition_encoder` | 1 / 4 | F32 | 25,167,881 | 100,671,524 | 50,335,762 |
| `language_model` | 4 / 399 | BF16 | 8,584,475,648 | 17,168,951,296 | 17,168,951,296 |
| `rvq_depth_decoder` | 1 / 47 | BF16 | 646,025,216 | 1,292,050,432 | 1,292,050,432 |
| `transformer` | 2 / 441 | F32 | 2,431,905,920 | 9,727,623,680 | 4,863,811,840 |
| `vocoder` | 1 / 121 | F32 | 54,170,722 | 216,682,888 | 108,341,444 |
| **Total** | **9 / 1,012** | Mixed on disk | **11,741,745,387** | **28,505,979,820** | **23,483,490,774** |

The requested BF16 representation is therefore **21.870705 GiB**, leaving nominal **2.129295 GiB** within a 24 GiB capacity before KV cache, activations, temporary copies, CUDA/runtime allocation and any retained FP32 buffers. These are tensor-element counts, not a claim about trainable parameter counts. This arithmetic is **not measured VRAM**: loading/casting, weight sharing, buffers and allocator behavior can change actual residency. Header validation does not establish the full files' SHA-256 integrity; that still requires byte verification during hydration.

Current local load order is explicit in `/home/ubuntu/salad-media-infra/routes/music3/server.py:31`: construct the local modular pipeline, `load_components(dtype=torch.bfloat16)`, then `.to("cuda")`; startup calls this before readiness. No CPU/group offload or quantization is enabled. The Dockerfile pins Diffusers commit `dafe3733fcfdbf3c48915fe77be3aef65b5d6a2d`.

At that exact upstream revision, `MiniMaxMusic3Blocks` orders text encoding, semantic generation, chunk preparation, denoising and decoding. The semantic step uses the language model and depth decoder together, retains `past_key_values`, and extends them on successive audio frames. The later steps use condition encoder/transformer and vocoder respectively. The present worker moves all loaded components to CUDA beforehand; the staged algorithm is not evidence that this worker automatically evicts idle components. [Pinned block sequence](https://github.com/huggingface/diffusers/blob/dafe3733fcfdbf3c48915fe77be3aef65b5d6a2d/src/diffusers/modular_pipelines/minimax_music3/modular_blocks_minimax_music3.py#L64), [pinned autoregressive cache](https://github.com/huggingface/diffusers/blob/dafe3733fcfdbf3c48915fe77be3aef65b5d6a2d/src/diffusers/modular_pipelines/minimax_music3/encoders.py#L313)

The retained model README was fetched from R2 and fully hash-verified (`d24a3e65f3ab0b3b9852986fc2d63dffbdfb8b0472d502dd3de47a24d41c623a`). It presents the same BF16 CUDA example as suitable for 24 GB-plus cards and discusses offload separately. That is upstream guidance, not this worker's measured qualification. The small source/config GETs are separate from the 112,128-byte header-only total.

**Minimal safe next profile:** first qualify the existing one-job-at-a-time, exact-revision, full-BF16, 30-step, no-offload 3090 route as written. Record peak allocated/reserved and device-used VRAM across cold load, autoregressive generation, denoising and decode, including the longest intended duration/prompt and repeated warm jobs. Check duration-dependent cache growth, output quality, throughput and bounded cost. Do not declare it impossible from pack size, declare it safe from weights alone, or automatically change precision/offload/GPU. If measured headroom is insufficient, stage-scoped residency is a separate explicit profile to review and benchmark while preserving exact weights and inference settings; it is not an enabled fallback here.

A separate delivery mismatch also needs qualification: the pinned Diffusers documentation describes native **44.1 kHz** output and a reference-server conversion to **32 kHz**, whereas the current application receipt requires 32 kHz. The local worker writes at `pipe.sampling_rate` without an explicit conversion. Verify the instantiated vocoder rate and delivered WAV; do not merely relabel a receipt. No resampler or model change was made. [Pinned output-rate documentation](https://github.com/huggingface/diffusers/blob/dafe3733fcfdbf3c48915fe77be3aef65b5d6a2d/docs/source/en/api/pipelines/minimax_music3.md#L62)
