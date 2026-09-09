# Structural efficiency and new capability wave

Owner additions: 9 September 2026. Status: assessed and queued; the comic-page
replacement and new capabilities are **not implemented or qualified** by this
document. This extends goal items 152–178 while preserving the earlier 151.

## Operating decision

Each non-thumbnail module gets a dedicated structural-design pass, as defined
in [the hardening method](MODULE_HARDENING_METHOD.md). Work from the viewer's
required result backwards to its smallest useful generation unit. Retain a
short decision record: present mechanism, candidate mechanisms, expected gain,
quality invariants, failure cost, experiment, observed result and rollout.

This does not add a paid meta-agent stage to every episode. The engineering
decision is reused until its implementation or evidence changes. Provider and
quality policy, owner locks, scope isolation and spend fences remain intact.

## First case: one generated comic image per composed page

### Current-source assessment

- `src/lib/motionComic.ts:1590` iterates over individual panels and constructs
  prompt identities. The image adapter at `src/lib/novitaMedia.ts:1110` forwards
  prompt, negative prompt and seed. It does **not** transport the reference
  images that the wider TypeScript art request can represent.
- `src/lib/motionComic.ts:1568` writes a zero-spend atlas experiment plan. The
  code explicitly leaves the production generation route unchanged. This is
  useful planning machinery, not an implemented whole-page comic renderer.
- `src/engine/visualAtlasExperiment.ts` already represents reference angles,
  grid variants, effective tile resolution and baseline/qualification policy.
  Reuse its constraints where suitable. A free-layout comic page is different
  from a fixed square atlas and must not be forced into that representation.
- `scripts/mc_page_render.py:66` creates page geometry independently; panel
  images are then placed into it. A generated composed page needs a single
  consistent coordinate system shared by its actual art, masks and camera.
- Existing art-cache manifests and the latest exact-final-duration guard are
  useful foundations. Preserve them when adding a new representation.

### Proposed mechanism

1. Freeze the approved story, stable character identities and actual reference
   image fingerprints. Generate or reuse an authorized reference pack once,
   then pass its images through an explicitly supported transport on every
   page that needs them. A seed or repeated text is not reference conditioning.
2. Plan each page as a coherent composition with varied panel sizes, explicit
   reading order and narrative purpose. Submit one image-generation request
   per page, not one per panel. Keep current typography policy unchanged.
3. Bind the returned page to verified panel regions, masks, protected regions
   and narration cues. Compare generated geometry to the intended plan before
   rendering. Do not accept invented panel coordinates or crop off story art.
4. Reveal the original page progressively using art-derived stroke ordering
   and matching hand contact. Animate the camera over that same page space.
   Faster reveal changes the drawing/hold budget, not narration playback rate.
5. Cache reference art, page art, speech and reveal preparation independently.
   A layout/timing fix should not buy another image or repeat narration. An
   image defect invalidates its page and dependent reveal, not the entire book.

### Qualification experiment

Freeze the same approved scripts, style and characters for baseline and
candidate. Include recurring characters on later pages, different camera
angles/wardrobe constraints, dense and sparse layouts, and a late-page defect.
Compare ordinary and faster drawing variants against the same audio.

Before paid tests, prove real request transport, namespace isolation, geometry,
resolution budgets, reference/config cache invalidation and partial-retry
behavior through the actual adapters. Unsupported reference conditioning must
fail before spending, not silently degrade to text-only generation.

Then compare complete actual videos: every panel must be drawn, characters
recognizable across pages, speech readable and synchronized, unrevealed panels
hidden, and hand contact convincing. Review transitions and late panels, not
only a contact sheet or opening frames. Calibrate checks against approved art.

Measure cost per accepted page/video and wall time, counting references, page
resolution, failed takes, repairs, QA, GPU warm-up, orchestration and assembly.
For N panels across P pages, N versus P image requests is only a planning
comparison. It is not a measured N/P saving. A more expensive page or repeated
full-page rejection can erase the expected benefit.

No switch of the live provider, enabling an unqualified paid route, reducing
panel detail, dropping QA coverage, or changing thumbnail policy is authorized
merely by this design. If provider qualification is blocked, continue the
unpaid implementation/tests and another actionable goal item.

**Primary-source check, 9 September:** Baidu explicitly identifies comics and
multi-panel compositions as target uses of ERNIE-Image. That supports a
whole-page experiment, not a guarantee of our channel's visual quality.
[Official model repository](https://github.com/baidu/ERNIE-Image).
The documented Diffusers pipeline is text-to-image and its published usage
does not establish reference-image conditioning. Verify the actual deployed
worker's capability before designing around image references; do not assume
that adding an `images` field to a request makes conditioning happen.
[Official pipeline documentation](https://huggingface.co/docs/diffusers/main/api/pipelines/ernie_image).

## Structural opportunities beyond comics

These are investigation targets, not already-measured improvements:

- **Whiteboard repair:** the baseline supplied-plan change deleted indexed art
  and audio while retained receipts correctly refused a duplicate purchase.
  The [held preservation repair](WHITEBOARD_CHANGED_PLAN_CACHE_REVIEW_2026-09.md)
  now compares the actual image/audio inputs and preserves equivalent paid
  work. Its real-caller regression and independent review pass. Genuine changed
  generation inputs preserve the prior files and refuse before spending;
  per-artifact revisions and cross-brief/provider identity remain unfinished.
  Integrate those with existing durable claims rather than deleting receipts
  or introducing a second paid-work authority.
- **TTS:** compare natural contiguous speech units against per-line synthesis,
  preserving speaker changes, timing, pronunciation and resumability. Alignment
  and repair cost may outweigh fewer calls; listen to real comparisons.
- **Music:** derive the required duration and arrangement from settled
  narration/assembly timing; investigate qualified motifs or stems where the
  channel permits them. Avoid generating a replacement for an editing-only
  change, and preserve the originality policy.
- **Whiteboard/storyboard atlases:** use existing experiment geometry to test
  multiple related visuals per generation. Measure usable resolution,
  continuity, crop safety and rejection cost before enabling a variant.
- **Research and metadata:** share one immutable, freshness-bound source packet
  across consumers; keep distinct editorial decisions and output ownership.
- **Assembly:** reuse unaffected rendered segments and perform compatible
  compositing operations together when render parity and recovery remain
  intact. Do not turn a small correction into a full paid regeneration.
- **Shared stroke preprocessing:** `scripts/wb_scribe_sync.py:65` and the comic
  renderer each perform skeleton walks. Investigate a shared topology-aware,
  content-addressed trace cache keyed by art, scale, threshold and algorithm
  version. Measure CPU time and pen-travel quality, including disconnected
  components; cache speed alone must not preserve a poor reveal.
- **Lore composition passes:** `src/lib/loreshort.ts:638` fits/encodes shots,
  combines and grades them, encodes an end fade, then optionally encodes a
  title transition. Test compatible filter fusion with unchanged timing,
  compositing quality and per-shot recovery before consolidating encodes.

## New channel capabilities: selection and implementation

First compare actual catalog entries, registered executors, compiler rules and
qualified outputs against useful absent channel formats. A capability may need
better discovery or composition rather than a new module. Rank candidates by
new format range, reused foundations, implementation/test effort, per-video
cost, source/licensing constraints and quality risk.

For each selected addition, use the same deliverable sequence:

1. Current primary-source research and a measurable reference standard.
2. Minimal typed artifact contract, executable implementation, compiler and
   planner integration with no undeclared reads or overwritten outputs.
3. Independent known-bad/known-good gates and real rendered/audio evidence.
4. Cache, retry, batch preparation, cost and asset-retention integration.
5. Concise visual Golden card/detail, useful controls and actual progress;
   visually inspect desktop, phone and enlarged text, and exercise controls.
6. A genuinely unfamiliar automatic channel creation and complete private test
   video with no manual creative substitution, followed by verified release.

### First implementation shortlist, pending complete design/qualification

| Order | Capability and channel range | Existing foundation and actual gap | Main acceptance risk |
| --- | --- | --- | --- |
| 1 | Native portrait Scene Compiler: illustrated Shorts, compact explainers and learning clips | Extend Episode Graph/Scene Compiler. Both `sceneCompilerRender.ts:20` and `sceneCompilerBlocks.ts:60` currently refuse non-16:9 output. | Responsive composition and phone safe areas for every admitted scene type; removing the guard or center-cropping is not implementation. |
| 2 | Verified worked-example track: arithmetic and step-by-step study channels | Reuse Learning Contract, deterministic text/scene rendering and narration. `SceneCompiler.tsx:26` has map/chart/diagram/panel/puppet/screen kinds but no typed verified derivation-step contract. | Start with locally checkable arithmetic; bind each narrated/visible step to verified inputs. Do not claim unrestricted algebra or code execution. |
| 3 | Language-practice turn track: vocabulary, listening and bilingual dialogue channels | Reuse learning objectives, voice synthesis and timed text. `learningContract.ts:29` does not define a timed listen/respond/reveal track; comic dialogue synthesis is not a reusable practice timeline. | Supported languages/voices, genuine pronunciation audition, speaker mapping, pause timing, transcript/audio identity and answer-reveal alignment. |

These are selected research/implementation targets, not qualified production
capabilities. Their scope is additive and individually tracked in items
176–178. More formats are possible, but count the formats proved by actual
automatic creation, not a theoretical combinatorial total.

**Portrait staging boundary:** the first held stage develops native layout
profiles and renderer/frame proof while the existing production 16:9 fence
stays closed. Receipt schema, exact-master geometry/legibility QA, capability
selection and compiler wiring are the next integration stage. The current
illustrated family permits 60–900 seconds, default 300, so a portrait renderer
alone is not a qualified Shorts format. Shorts duration and caption promises
need their own tested contracts. Children's supervised 16:9 restriction stays
unchanged. Any initially refused evidence/character layouts remain unfinished
item 176 work, not a permanent scope exception or an invisible fallback.

**Reserve candidate:** verified software-demonstration capture could reuse
browser automation and assembly for tutorials. The existing `screen` graphic
does not demonstrate a real application action. This is not currently ranked
as easy: replayable state assertions, credential isolation, privacy/redaction
and a safe-action policy make it a larger undertaking. Keep it in discovery;
do not launch a browser-action pipeline under a generic screen-render label.

A candidate name or attractive module card does not count as delivery.

The [language-practice design](LANGUAGE_PRACTICE_CAPABILITY_DESIGN_2026-09.md)
records the actual English-only transcript/short-utterance constraints, typed
turn-track proposal and measured batching/replay experiment. Multilingual TTS
inputs are not multilingual QA. Existing English model pins and quality
thresholds are unchanged; the bilingual capability remains unqualified.
