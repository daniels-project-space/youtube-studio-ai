# Salad runtime inventory — 8 September 2026

This is observed evidence, not GPU qualification. All API operations performed for this inventory were reads or read-only availability POSTs. No group was created, started, resized, stopped or deleted.

## Live account and hardware

Vault namespace `salad` contains `SALAD_API_KEY`, `SALAD_ORG`, `SALAD_PROJECT`, and legacy `SALAD_LTX_*` / `SALAD_R2_*` fields. Authenticated reads succeeded. The configured project had zero container groups and two existing queues: `minimax-music3-jobs`, `ernie-image-smoke-jobs`. Organization quota: 10 replicas; used: 0.

| Exact live class | UUID | Medium USD/hour observed |
| --- | --- | --- |
| RTX 3090 (24 GB) | `a5db5c50-cbcb-4596-ae80-6a0c8090d80f` | 0.197 |
| RTX 5090 (32 GB) | `851399fb-7329-4195-a042-d6514b28cf33` | 0.380 |

The RTX 5090 Laptop is a different 24 GB class. Never select by substring. GPU classes and prices must be discovered again immediately before admission. Salad has announced a medium RTX 5090 price of $0.417/hour from 12 September; fixed historical rates are not sufficient for spend admission. [Official change notice](https://blog.salad.com/saladcloud-price-changes-september-2026/)

The application-wide limit is three concurrently allocated/reserved GPUs across all model groups. Three replicas per group would exceed that limit if several tools ran simultaneously. A transactional fleet lease is still required above the API client. Keep allocation/download/stopping capacity reserved until provider convergence is confirmed.

## Verified R2 packs

The correct model bucket is `salad-render-infra`. The legacy vault `SALAD_R2_BUCKET`/prefix point at `youtube-studio-ai/ltx/`, which does not contain these packs.

| Route | Immutable manifest key | SHA-256 of exact manifest bytes | Files verified present with exact byte counts |
| --- | --- | --- | --- |
| ERNIE SFT, 3090 | `ernie-image-sft-v1/immutable-manifest.json` | `4147d735ed0663a83460034da391f5a4c081aefef44ef2f37ad7163f7e275637` | 4 / 4; 30,998,316,546 bytes |
| MiniMax H3 Turbo8, 5090 | `minimax-h3-turbo8-5090-v1/immutable-manifest.json` | `eca7ade81afd2edd4b912275a8657b9504cab71ca7e538aed7ce12f27acc90c9` | 5 / 5 |
| MiniMax Music3 BF16, 3090 | `minimax-music3-bf16-v1/immutable-manifest.json` | `fde881bc3a6fe11fecb6c2211967038093766f9db2ca0c07e89e846117e1c32a` | 88 / 88; 57,353,379,600 bytes |

Each manifest lists object keys, byte lengths and per-file hashes. Listing/size verification does not prove every stored file's content hash; the existing worker hydrator must rehash the actual bytes before inference.

ERNIE source: `Comfy-Org/ERNIE-Image` revision `01bcb3f1acdb1454ee579d2796ecc4c156873eea`. Files: SFT diffusion model, Prompt Enhancer, Ministral-3-3B text encoder, Flux2 VAE.

H3 is resolved from actual R2 evidence: `Comfy-Org/MiniMax-H3` revision `4cc1d817b6184899b41293954329f576cb5ae86b`. The pack contains FL2VA pruned INT8 ConvRot diffusion weights, Qwen3VL-32B NVFP4 AWQ encoder, FP16 video VAE, FP32 audio VAE and official BF16 eight-step Turbo LoRA. It is not the old Hailuo API route.

Music source: `MiniMaxAI/MiniMax-Music3` revision `fbdf52fbaaca799592917417eb05f1899f1255ec`, matching the current YouTube adapter's model revision. The external Salad runtime's delivery and infrastructure receipts do not match the current YouTube adapter yet.

Additional source archives exist at `worker-runtime/comfyui/{3ac5d7941dfa2504555260512132d1cb5664648d,72865f4f27eaf5396f8f36370e0a2be3a9a090ee,e20d433a4966dcc88fa5abbae6ace824cb78b263}/source.tar.gz`. Their runtime compatibility/digests have not been qualified. The old shared worker archive is `worker-bootstrap/novita-shared-workers/20260829-v100/worker.tar.gz`; its presence does not establish that it is the current Salad runtime.

No Qwen3-TTS model pack or Salad worker image was located in these bounded model prefixes or the current Salad runtime repository. Do not treat the Music3 Qwen language-model weights as Qwen TTS.

## Existing worker code and protocol

Source: `/home/ubuntu/salad-media-infra`. Graphify and current route files were inspected. It already implements model hydration, exact GPU checks and separate routes; reuse these contracts rather than inventing parallel workers.

| Route | Resources in current source | Existing endpoint | Actual response |
| --- | --- | --- | --- |
| ERNIE | 3090, 4 CPU, 32 GiB RAM, 48 GiB disk, port 8188 | `POST /v1/images` | JSON receipt after presigned R2 PUT |
| H3 | 5090, 8 CPU, 128 GiB RAM, 100 GiB disk, port 8080 | `POST /v1/videos` | JSON receipt after presigned R2 PUT |
| Music3 | 3090, 8 CPU, 64 GiB RAM, 80 GiB disk, port 8080 | `POST /v1/audio/speech` | WAV response; no durable R2 receipt |

All expose `/healthz`. ERNIE/H3 hydrate before serving; their health response also carries `ready`. Music loads its pipeline during startup. IPv6-capable `uvicorn --host '*'` is required by the existing Salad gateway setup.

ERNIE request: `prompt`, integer `seed`, `output_put_url`, `prompt_enhancer`. Current native quality is 1024×1024, 50 steps, CFG 4; no arbitrary 16:9 input. H3 request: `prompt`, `seed`, `first_frame_url`, `first_frame_sha256`, `output_put_url`, profile `official-turbo8-native-768p`. Current H3 profile: 1344×768, 24 fps, 124 frames, eight steps. Its latent/4K proof is disabled and unqualified. Music request: `input` (lyrics), `instructions` (music prompt), `seed`, `audio_duration`, exactly 30 `num_inference_steps`, `response_format: wav`.

The routes have no Salad queue-worker `/process` protocol today, no proven durable job deduplication, and incomplete batch checkpoint/resume semantics. ERNIE unloads its models after each render, so image reuse alone does not remove model loading cost.

The Music3 worker eagerly calls `.to("cuda")` on the full BF16 pipeline. A single 24 GB 3090 memory-fit proof is missing; the source explicitly returns failure on OOM. The existing YouTube Music3 receipt instead requires two Novita 4090s. This must be resolved with measured stage residency and an approved full-quality runtime, not an unchecked provider-label change.

The existing H3 group builder sets `country_codes: ["cn"]` because its source records license exclusions. Preserve that scheduler restriction until current license scope has been verified. Do not widen regions to gain availability without resolving the license requirements.

## OCI and qualification gaps

A local Docker repository digest exists for `ghcr.io/danielmabro-new/salad-media-infra@sha256:bce44326b54d698004f90ce03b77f45a9dcd4bff13aa88b4ec36aeabe77f25d0` (tag `ernie-20260902-compact`). Local digest presence does not prove remote pull authorization, the current source-to-image mapping, successful inference, or output quality. H3, Music3 and Qwen TTS immutable runtime image references remain unresolved. No image is activated by this inventory.

The R2 report `salad-media-tests/20260902/ernie-medium-parallel-hydration-79568c89219d499ba4b1f395e0d32521/report.json` records `success: false`, `artifact: null`, 1500.514 seconds elapsed. The container reached running after about 930 seconds, but never recorded worker-ready/inference success before teardown. Treat this as evidence for cold-start/hydration investigation, not qualification.

## Provider API details

- API base `https://api.salad.com/api/public`; auth header `Salad-Api-Key`. GET `/organizations/{org}/gpu-classes`, `/quotas`; GET `/organizations/{org}/projects/{project}/containers`. Availability is read-only POST `/organizations/{org}/availability/sce-gpu-availability` with exact resource filters and optional country codes. [Preflight reference](https://docs.salad.com/agents/container-engine/discover-scope-and-preflight)
- Create POST `/.../containers`; priority must be nested `container.priority: "medium"`. `autostart_policy: false`, digest-pinned `container.image`, `image_caching: true`, `replicas: 0` can prepare an image without GPU allocation. Update uses PATCH `/.../containers/{name}` and `application/merge-patch+json`. [Create reference](https://docs.salad.com/reference/saladcloud-api/container-groups/create-container-group)
- Start/stop POST `/.../containers/{name}/start|stop` return 202. Confirm group and GET `/.../containers/{name}/instances`; stopped group status alone can precede actual node termination. Billing starts at running and ceases when runtime capacity has actually stopped. [Lifecycle operations](https://docs.salad.com/agents/container-engine/monitor-and-operate-container-group), [billing lifecycle](https://docs.salad.com/container-engine/explanation/container-groups/deployment-lifecycle)
- Queue POST `/.../queues/{queue}/jobs`, GET `/.../queues/{queue}/jobs/{id}`; store provider job ID immediately. Native queue worker forwards JSON to the configured local HTTP endpoint; 200 acknowledges completion, 500 may trigger three retries/four total attempts. A costly stage needs its own durable request identity and spend-aware recovery. [Queue use](https://docs.salad.com/container-engine/how-to-guides/job-processing/using-queues), [worker behavior](https://docs.salad.com/container-engine/how-to-guides/autoscaling/enable-autoscaling)
- Queue autoscaler supports `min_replicas: 0`, `max_replicas: 3`, desired queue length 1–100 and polling period 15–1800 seconds. Per-group limits cannot enforce the global three-GPU maximum. Scale-in can interrupt running work; use active-job drain evidence and deletion costs. [Autoscaling settings](https://docs.salad.com/container-engine/reference/autoscaling/settings), [deletion costs](https://docs.salad.com/container-engine/explanation/infrastructure-platform/instance-deletion-cost)
- Webhook headers: `webhook-signature`, `webhook-id`, `webhook-timestamp`; verify raw body with the queue's webhook secret using the documented Svix scheme. That secret is not in the discovered Salad namespace yet. [Signature reference](https://docs.salad.com/container-engine/how-to-guides/job-processing/webhook-signature)

Run `pnpm exec tsx scripts/salad-runtime-preflight.ts` for a fresh, credential-redacted inventory. It calls no GPU lifecycle methods. Its unqualified classifications must remain until measured evidence replaces the gaps above.
