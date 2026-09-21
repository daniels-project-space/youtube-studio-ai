# YouTube Studio isolated render build

## Dedicated YuE2 rebuild

From a clean committed Studio checkout, the music lane has its own executable
build command, pinned to runtime source `373e13933d0127847d266740153ac22769b4a2a9`:

```sh
node scripts/studio-yue2-build.mjs build-and-verify-cache
node --test scripts/__tests__/studio-yue2-build.test.mjs
```

`prepare` creates only the detached worktrees and curated Docker context.
`build` additionally builds the image and compares its actual offline manifest
with the source manifest. `build-and-verify-cache` also hashes every retained
weight in the real image with networking disabled and the model volume mounted
read-only. An empty or corrupt cache fails; the command never downloads weights,
allocates a GPU, starts generation, or changes qualification. Use the runtime's
explicit operator staging command to populate an empty cache first.

Each attempt retains its own receipt under
`/var/lib/youtube-studio-render/builds/yue2-<runtime-revision>/`. Receipts bind both
Studio and runtime revisions, immutable local image ID, manifest verification,
separate `volumes/yue2/models` and `volumes/yue2/state` paths, and any cache proof.
No H3/other-project state is mounted. Only allowlisted tracked runtime sources
enter the build, even if credentials or job data were accidentally tracked.

## H3 build

This builds Studio's existing H3 API contract with its own pinned ComfyUI
installation. It does not borrow Book Forge or Lito's image, Python environment,
custom nodes, writable model cache, request queue, or receipts. It does not
change the existing OpenRelay A100 fallback or legacy channel pipelines.

From a clean, committed Studio checkout:

```sh
node scripts/studio-render-build.mjs build
node --test scripts/__tests__/studio-render-build.test.mjs
```

The builder creates independent detached worktrees for Studio and the pinned
renderer source `42faf114e1088f8ff10369f02095f9ec82493b4d`. Each build attempt has
a separate curated Docker context and JSON receipt under
`/var/lib/youtube-studio-render/builds/<studio-revision>/`. Only the H3 worker,
common worker utilities, exact model/profile manifests, and Studio Dockerfile
enter the context. No environment files, graph output, media, or weights enter.

The image has an app-owned tag, OCI source/revision labels, ComfyUI commit
`f938505952476e48a12687eac696cdc94d48a3fe`, and retained Python dependency inventory
at `/opt/youtube-studio/python-freeze.txt`. The build receipt records the actual
local image ID; this is not a registry digest or proof of a deployed image.
Release labels follow dependency layers so unrelated Studio commits can reuse
those expensive layers. Other projects' Docker cache/images are never pruned.

## Disk boundaries

| Purpose | Studio-owned host directory | Container path |
| --- | --- | --- |
| Verified H3 weights and local manifest | `/var/lib/youtube-studio-render/volumes/h3/models` | `/models` |
| Input cache and completion receipts | `/var/lib/youtube-studio-render/volumes/h3/state` | `/workspace/youtube-studio/h3` |

Mount these directories only into this Studio worker. The model directory is
writable because the existing hydrator locks and maintains its verification
receipt there. It must never be a shared writable model mount. Another lane
(YuE2, Qwen, LTX, or a future ComfyUI control route) needs its own worktree,
image, volume subtree, and qualification; none uses this lane's mutable state.
Directory and worktree symlinks are refused by the builder.

The image performs GPU admission and checksum-gated cache verification before
starting its API. `MODEL_CACHE_MODE=preseeded-only` and offline Hugging Face
settings prevent a customer render from downloading models. Populate and
verify the exact five-file H3 pack using the existing operator staging path;
`scripts/build-openrelay-h3-bootstrap-manifest.ts` produces the hash-bound
verification manifest and a separate sensitive, short-lived bootstrap manifest.
Never commit or include the signed bootstrap URLs in an image.

This image retains the RTX 5090 profile. It is not a drop-in replacement for
the legacy A100 VM image: hardware admission deliberately rejects that swap.
No GPU lifecycle command is part of this builder. Provider credentials stay in
the control plane; worker tokens must be injected at runtime, not baked in.

## Verification boundary

Every successful build executes `smoke.py` against the actual container API,
with networking disabled, read-only root, no Linux capabilities, and ephemeral
test state. It verifies the Comfy pin, unauthenticated denial, authenticated
GET-only receipt recovery, drain behavior, and an honest not-ready response for
an empty model cache. It never renders an image or thumbnail.

The receipt deliberately keeps `gpuQualified` and `modelCacheVerified` false.
An image build/API smoke pass cannot prove GPU inference, warm-cache integrity,
output quality, provider deployment, or production activation.

## Credential and volume discovery: 21 September 2026

Studio now uses only `youtube/OPENRELAY_API_KEY` and `youtube/OPENRELAY_ORG_ID`
from Project Hub. The owner-supplied replacement passed real VM create, SSH,
stop, restart and retained-disk checks on 21 September. The previous Studio
record was replaced, not retained as a fallback. Shared `openrelay` records
belong to other projects and are no longer hydrated by Studio bootstrap.
Local credential scans found no literal provider keys in 2,687 inspected files;
Trigger production had no OpenRelay environment override at verification.
Never copy a key into this document, a build receipt, or the worker image.

Read-only live inventory found eight stopped VMs. Studio-owned retained disks:

| VM | Capacity GB | Provider-reported used bytes |
| --- | ---: | ---: |
| `yt-minimax-h3-a100-persistent` | 150 | 68,665,212,928 |
| `yt-minimax-h3-a100-fallback` | 100 | 65,957,593,088 |
| `yt-qwen3-tts-3090-primary` | 30 | 26,302,087,168 |

These are populated disks, not missing infrastructure. All three reported SSH
offline while stopped. Disk usage does not attest individual file hashes or
runtime health. No VM was restarted, resized, deleted, or moved between apps
by this build/discovery operation.

## Studio deployment identity: 21 September 2026

Studio now has a separate registered OpenRelay SSH public key, rather than
borrowing the existing Lito identity:

- Name: `youtube-studio-openrelay-20260921`.
- Provider key ID: `09214611-edeb-432a-8657-415b9b400f25`.
- Fingerprint: `SHA256:txq9MwrqytgLlYueelWcv9LWio5br57PDH81CCa+7yU`.
- Local private key: `/var/lib/youtube-studio-render/operator/ssh/openrelay_ed25519`.
- Public metadata receipt: `/var/lib/youtube-studio-render/operator/openrelay-ssh.json`.

Registration was read back from the canonical organization and matched against
the public key derived from the local private key. The private file has no
group/other permissions; operator directories are outside all model/state
mounts and curated build contexts. Never copy the private key into a worker,
image, repository, or provider environment variable. Only its public half was
sent to OpenRelay.

The identity was exercised against the isolated validation VM
`29e245a2-2e1a-431e-b5b3-654cf0ba1587`. SSH verified an RTX 3090 with 24,576 MiB
VRAM, 28,634,255,360 bytes available guest RAM, Docker, and the separate 60 GB
disk. A random probe's SHA-256 matched after stop/restart. The VM was stopped
again and terminal status verified; no other project's VM or SSH key changed.
Receipts are under `/var/lib/youtube-studio-render/operator/credential-validation-*`.
This proves credential/lifecycle/SSH operation, not YuE2 inference, image
deployment, musical quality or production readiness. The key was supplied in
chat for temporary testing and must be rotated by the owner after validation.

## Live YuE2 GPU deployment: 21 September 2026

The verified 3090 VM now retains its own build context, Docker image, model cache
and ledger under `/var/lib/youtube-studio-render/`. The deployed runtime source
is `e5e59b74cd15c3dd3c483c8e6df89f1e44592214`; the Studio builder pins this revision.
The remote Docker image ID is
`sha256:beef55e2f9ad478c54d613eb6a063118c46b41cd0e5f4ee8ee80937d5a5f9e87`.

For this host, transfer the builder's allowlisted context (about 100 KB) and build
on the VM. Bulk SSH image/model transfer was slow; direct pinned dependency and
public-checkpoint downloads completed successfully. Do not upload private build
images to Studio's media bucket: its public development domain is enabled. No
private image was uploaded there. Provider credentials remain on the controller.

Run cache staging as UID/GID 1000, matching the Studio GPU volume owner, with
`HOME=/tmp`, read-only container root, all capabilities dropped, and no-new-privileges.
Staging alone gets network access and a writable cache mount. The same image
verified all five pinned checkpoint files (7,794,517,915 bytes). Inference gets a
read-only cache and `--network none`; its ledger is a separate writable mount.

`yue2_gpu_preflight.py` runs inside the real image with GPU access and the same
thread-only seccomp/parent-death protection as the inference child. It verified
installed source/package pins, offline checkpoint hashes, RTX 3090 identity,
available RAM and actual FP32/BF16 CUDA matrix products. The CPU-host negative
check refuses to substitute CPU execution. This is not music-quality approval.
The retained receipt is `/var/lib/youtube-studio-render/operator/yue2-gpu-preflight.json`.

`yue2_supervised_probe.py --job /absolute/job.json --policy /absolute/policy.json`
executes one strict personal-creator job through the existing runtime supervisor.
It does not invent a channel profile, change model settings, provision compute,
or approve music. Every attempt remains in the mounted ledger. The first live
attempt exposed a missing passwd entry for UID 1000 during Torch cache setup;
the pinned image now registers `studio`, without widening capabilities or
changing inference precision. Preserve that failed receipt when evaluating the
explicit retry. The external VM shutdown guard remains separately required.

The retry completed on the real GPU. See
[`docs/yue2-live-evaluation-2026-09-21.md`](../../docs/yue2-live-evaluation-2026-09-21.md)
for native-output hashes, retained receipts, measured timing, duration mismatch
and clipping-review findings. Generation success is not production approval.
