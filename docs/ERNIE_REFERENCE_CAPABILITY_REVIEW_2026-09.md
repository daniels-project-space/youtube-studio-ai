# Existing ERNIE worker — actual reference capability

12 September 2026. **Read-only investigation completed; no reference-conditioned route is implemented or qualified.** This resolves the unknown in comic backlog items 152–153 without replacing the owner's requested character-input requirement with text consistency.

## What the stored worker actually contains

The [sanitized evidence](../test-fixtures/ernie-reference-capability/evidence.json) binds the current local worker to the full bytes fetched from R2, not merely to a model name or old inventory:

- Bucket `salad-render-infra`; worker `worker-bootstrap/ernie-image-salad-3090/20260910-v3/worker.tar.gz`, 11,657,447 bytes, SHA256 `84350c1ff8aeeb6028cfc6eb52b43dd601320d30d92f9874d8f093590be3d999`. It matches its stored manifest; ComfyUI revision is `3216c62e9962c3babd28a4dfea6e5aef50b8fe16`.
- Model manifest `ernie-image-sft-v1/immutable-manifest.json` retains SHA256 `4147d735ed0663a83460034da391f5a4c081aefef44ef2f37ad7163f7e275637` and `Comfy-Org/ERNIE-Image` revision `01bcb3f1acdb1454ee579d2796ecc4c156873eea`. Four listed model objects match their manifest sizes. The 31 GB of model weights were not downloaded or independently rehashed.
- Newer multi-aspect, durable warm batches are present. The September 8 square-only/no-dedup description is historical and must not guide current integration.
- Actual batch `validate_item` accepts a valid 1536×1024 control but rejects each of `referenceImages`, `image_url`, `reference_latents`, and `image`, before network or rendering. Its allowed fields are exactly `id`, `prompt`, `negativePrompt`, `width`, `height`, `seed`.
- Both legacy and batch render implementations encode text and sample from `EmptyFlux2LatentImage` with denoise 1.0. Their ERNIE model adapter supplies text cross-attention; it does not encode or inject a reference image. The inspected old shared Novita worker and three stored ComfyUI archives do not provide an alternative ERNIE reference path.

This conclusion is based on the actual request validator, sampling workflow and model implementation. Token searches or the presence of reference-capable *other* ComfyUI models would not be sufficient evidence.

## Scope and next decision

A live read at **14:12:45 UTC** found zero Salad container groups in the configured project. That observation is not a permanent capacity claim, nor a reason to rent a GPU to prove a missing request field. No GPU lifecycle mutation, paid inference, R2 write/delete, model change, production route change or quality downgrade occurred.

Preserve the text-to-image contract and its rejection of unsupported references. A real cross-page reference route needs an appropriate model/adapter, immutable image-byte propagation and job fingerprints, then a measured full-page/identity comparison. Do not describe a shared seed, text traits, QA-only reference or generic img2img as established identity conditioning.

The owner was asked asynchronously whether to permit a **maximum-$1, test-only Nano Banana Pro comparison through Fal**. Approval is pending; no test or fallback is enabled. Fal's [current edit route](https://fal.ai/models/fal-ai/nano-banana-pro/edit) explicitly accepts image inputs and lists $0.15/image, doubled for 4K, but this is provider capability/pricing information—not our own comic quality result or authorization to change production. Existing thumbnail configuration remains untouched.

Other goal work continues. The hand-reveal and exact-stroke CPU repairs are independently validated and released as `9cbab32` / Trigger `20260912.25`; the separate overlay-encoding experiment has not passed exact pixel/alpha preservation. Its faster two-thread result is closer to source on the initial fixture, which justifies a separate full-length quality study—not adoption or a relaxed pass for the failed exact-parity experiment.
