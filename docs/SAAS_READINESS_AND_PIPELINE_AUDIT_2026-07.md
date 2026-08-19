# YouTube Studio AI: SaaS Readiness and Pipeline Audit

**Date:** 2026-07-19
**Scope:** `/home/ubuntu/youtube-studio-ai`, `/home/ubuntu/novita-render-infra`, `/root/ltx-build`, the live Novita bridge boundary, current generated artifacts, and current official provider/platform documentation.
**Method:** Current source and callers were traced symbol-first, repository graphs were queried before broad traversal, representative pipeline designs were executed through validation, build and smoke checks were run, and the current “A Dying Art” artifact and its production path were inspected. No production state was changed.

## Executive verdict

The repository is a credible **single-operator R&D studio with a real orchestration kernel**. It is not yet a safe multi-tenant SaaS, and it cannot currently deliver the intended “channel in one shot” promise with Golden-module guarantees.

The strongest part is the execution core: registered blocks, declared artifacts, graph validation, persistence, retries, remote child tasks, resume/rehydration, cost rollup, and a substantial deterministic channel designer all exist. The biggest gap is that the product language is ahead of the runtime contract. “Golden” modules and the Golden spine are catalog/UI concepts, crew handoffs are hidden store reads, and the Novita blocks are registered but unreachable from a valid designed pipeline.

The current generated-video path is not yet a story-aware production system. It creates a small number of loosely prompted clips from truncated script sections, has weak continuity, and relies on sparse, mostly fail-open QA. The strongest apparent proof point, “A Dying Art,” is a visually coherent one-off whose approximately 100-shot story was manually authored. Its automated assembly discarded roughly 28 planned shots, aligned broad musical sections rather than lyric-level timestamps, accepted weak completion markers, and upscaled a 1080p master to 1440p. It demonstrates craft and useful components, not a reusable autonomous pipeline.

Multi-account YouTube support is a release blocker. The application has no real user/organization authentication or tenant authorization; OAuth state is not a secure session-bound nonce; refresh tokens are stored in plaintext; uploads can fall back to one global refresh token; analytics always use a global token; the analytics scopes are missing; and the scheduling/learning crons are paused. Separately, the live render bridge is reachable without authentication when its token environment variable is absent and can launch billable compute. That should be treated as an immediate security and cost incident, not normal technical debt.

### Readiness scorecard

These scores measure readiness for the stated SaaS outcome, not the amount or quality of code already written.

| Surface | Readiness | Assessment |
|---|---:|---|
| Execution kernel | 3/5 | Real and useful; resume, retries, artifacts, cost rollup, remote tasks, and validation exist. Provider readiness and predictive budget gates are incomplete. |
| Channel designer | 3/5 | Deterministic family designs plus a bounded architect agent are substantive. Designs do not enforce Golden policy, and several duration/family edge cases are invalid or implausible. |
| Golden modules/spine | 1/5 | Catalog and UI only; no runtime certification, version pinning, or mandatory capability enforcement. |
| LEGO module contracts | 2/5 | Central registry and basic I/O exist, but hidden optional reads and disconnected settings violate composability. |
| Narrated/generated video | 2/5 | Functional provider calls exist, but semantic coverage, continuity, timing, and production Novita integration are missing. |
| Visual and final QA | 2/5 | Structural checks exist; story, genre, identity, and motion checks are sparse, advisory, or fail-open. |
| YouTube for one trusted operator | 3/5 | Real OAuth and resumable-session upload foundations exist. Scheduling and analytics are not operating as a per-channel system. |
| Multi-tenant SaaS/security | 1/5 | No trustworthy tenant boundary, connector vault, authorization, or secure external-action surface. |
| CI and operational evidence | 2/5 | Typecheck/build/core smokes pass. CI skips the test suite, lint is red, and two direct assertions currently fail. |

**Overall:** 2/5 for the requested future SaaS. This is a promising platform foundation that needs a contract-and-security phase before more channel templates or visual styles are added.

## What is real today

### Runtime architecture

```text
Next.js UI/API
    |
    +-- Convex: channels, pipelines, stage state, artifacts, costs, plans
    |
    +-- Trigger.dev: long-running pipeline and block execution
             |
             +-- LLM/TTS/search/stock/FAL providers
             +-- FFmpeg/Remotion assembly
             +-- R2 artifact storage
             +-- YouTube upload and analytics helpers
             +-- HTTP VPS bridge --> Novita GPU instances
```

The desired render boundary should instead be:

```text
Authenticated app --> durable job truth in Convex/Trigger
                              |
                              +-- signed, idempotent render manifest
                                      |
                                      v
                         Novita-local render coordinator
                         + spot GPU worker leases
                         + Network Volume model cache
                         + ephemeral instance scratch
                         + R2 checkpoints and final artifacts
```

The VPS should not be a render scheduler, credential broker, or source of job truth. A small durable control plane can remain in Convex/Trigger while all model-aware scheduling and execution happen on Novita, close to cached weights. Workers must be recoverable from a manifest and external checkpoints because spot and local instance disks are disposable.

### Execution engine

The current engine is not a facade. In `src/engine/types.ts`, a block declares `consumes`, `produces`, cost behavior, and a `run` implementation. `src/engine/validate.ts` validates the ordered graph. `src/engine/runner.ts` handles persistence, retry, resume/rehydration, remote children, limited parallel groups, stage costs, and failure propagation. `src/trigger/runPipeline.ts` loads the channel and pipeline, seeds channel artifacts, invokes the runner, performs limited healing, and persists outputs.

Important limits:

- Validation proves that required key names appear earlier in the list; it does not validate artifact schemas, model/provider compatibility, semantic quality, or hidden store reads.
- Paid-stage budget enforcement is mostly retrospective. A job can spend before discovering that it exceeded budget.
- Provider preflight is optional and not consistently supplied with provider-specific requirements from the top-level run.
- The runtime accepts a caller-supplied logical owner ID without deriving it from an authenticated user.
- Resume exists, but external side effects need stronger idempotency contracts. Trigger.dev supports task-level idempotency keys specifically to prevent duplicate child work during parent retries; this should be part of every paid or publishing block contract ([Trigger.dev idempotency documentation](https://trigger.dev/docs/idempotency)).

## Why “one-shot channel creation” is not yet true

### Golden is not executable policy

The registry currently contains 43 executable block IDs. `GOLDEN_MODULES` contains 27 catalog entries, and the Golden page is its only runtime consumer. `GOLDEN_SPINE` explicitly describes itself as reference/documentation rather than an executed graph. It includes at least one module name (`outlier_research`) that is not registered, while several catalog cards use product names that are not executable IDs.

Consequences:

- A channel can be designed and run without inheriting the claimed Golden spine.
- “Golden” means curated in the UI, not tested, versioned, certified, or required.
- An architect proposal is constrained to a whitelist, but it does not solve a capability graph against an executable Golden policy.
- There is no immutable record of which model, prompt, module version, quality threshold, or Golden artifact certified a pipeline.

The right abstraction is a versioned `ModuleManifest`, plus a capability-based `PipelinePolicy`:

```ts
type ModuleManifest = {
  id: string;
  version: string;
  capabilities: string[];
  consumes: Record<string, JsonSchema>;
  produces: Record<string, JsonSchema>;
  optionalConsumes: Record<string, JsonSchema>;
  providerProfiles: ProviderProfile[];
  configSchema: JsonSchema;
  costAndLatency: BudgetEnvelope;
  idempotency: IdempotencyPolicy;
  retryAndResume: ResumePolicy;
  qualityContract: QualityContract;
  securityAndSideEffects: SideEffectPolicy;
  certification: GoldenCertification;
};
```

The Golden spine should require capabilities such as `topic.researched`, `script.qa_passed`, `visuals.story_aligned`, `final.originality_passed`, and `publish.user_approved`; it should not hard-code one implementation ID. The channel architect may choose among certified modules, but a deterministic compiler must resolve dependencies, validate schemas and provider profiles, reserve budget, enforce side-effect policy, and reject uncertified combinations.

### The deterministic designer has useful depth but important edge failures

`src/engine/designer.ts` supports multiple archetypes, families, niche presets, toggles, duration/language parameters, swaps, crew modules, inserts, Shorts, and cross-posting. `src/trigger/designChannel.ts` adds channel identity, research, StyleDNA, ShowBible, QualityBar, labs, and a bounded architect agent. This is a strong base for the intended experience.

Representative validation exposed concrete product gaps:

- The cinematic family is declared unavailable, and its attempted 10-minute design fails because `timeline_assemble` consumes `entityClips` without an upstream producer.
- A 10-minute Shorts request generates a 600-second script and a long-form length band, contradicting the format.
- The comic family clamps the plan to 12 panels even for a 10-minute request, which is unlikely to meet visual pacing or coverage requirements.
- None of the family designs enforces an executable Golden spine.

The architect LLM should remain a proposal mechanism. The deterministic compiler—not the LLM—must own validity, certification, cost, safety, and publish permissions.

## LEGO modularity and crew handoffs

The current registry is a good start, but a module is not self-contained if its behavior depends on undeclared store keys.

Crew modules produce `structure`, `visualBrief`, `cutSheet`, `musicBrief`, and `validationSpec`. Downstream blocks silently read these artifacts, but their declared `consumes` lists omit them. For example, script generation can use `structure`; visual generators can use `visualBrief`; narration/music can use `musicBrief`; assembly can use `cutSheet`; and visual QA can use `validationSpec`. The validator therefore allows a crew block to be removed or reordered while downstream behavior silently degrades.

The configuration surfaces compound this issue. Most role-specific configuration resolvers are exercised by tests or UI code but are not supplied to the actual crew calls. A richer `dpCoverage` branch exists but no designer/toolbox/config path sets it. The result is a “showroom control”: it appears configurable while the runtime uses defaults.

Required contract changes:

1. Every store read must be declared as required or optional input, with a versioned schema.
2. Optional inputs must have an explicit deterministic fallback and record that fallback in provenance.
3. Each configuration field must have a traced path from UI/API to the consuming runtime call; disconnected controls fail certification.
4. Side effects, paid calls, retries, idempotency, compensation, and checkpoint behavior belong in the manifest.
5. Contract tests must execute modules with only their declared inputs and prove that undeclared reads are impossible.
6. Crew handoffs must be first-class artifacts with stable IDs and ownership, not ambient context.

Recommended crew artifact spine:

```text
ChannelSpec
  -> VideoIntent
  -> ResearchDossier
  -> DirectorTreatment
  -> TimedScript
  -> NarrativeBeat[]
  -> ShotPlan[]
  -> DPVisualSpec[]
  -> EditorEDL
  -> ComposerCueSheet
  -> CriticValidationSpec
  -> CertifiedMaster
```

Each downstream consumer should point to exact upstream artifact IDs and versions. That makes handoffs inspectable, replaceable, resumable, and testable.

## Narrated and generated-video quality

### Current narrated/generated path

The main generated-footage path in `src/trigger/blocks/genFootageBlocks.ts` currently uses Gemini plus FAL, not the Novita render plane. It takes at most 24 script sections, truncates each section to a short excerpt, asks for a rough set of beats, and generates still-plus-motion assets. At the current 5–10 second clip range, a 10-minute episode can receive no more than about 240 seconds of unique generated footage before reuse or other filler.

It does not carry sentence timing, source evidence, persistent entity/location/wardrobe IDs, camera continuity, or an exact beat-to-shot mapping. A scene can be skipped after provider failure, and the block succeeds once a small minimum number of clips exists. This directly explains the observed class of failures: imagery that is attractive but unrelated to the spoken sentence, wrong genre, generic B-roll, discontinuity, and insufficient coverage.

The registered Novita blocks do not solve this today. `novita_render_images` and `novita_render_video` consume a `shotList`, but no registered block produces that artifact. They are absent from the designer families and architect toolbox, so a normal validated pipeline cannot reach them.

### Required story-to-frame contract

The production path should be:

```text
Script with sentence/word timestamps
  -> narrative beats with exact t0/t1 and evidence
  -> shot plan with coverage and continuity constraints
  -> multiple keyframe candidates
  -> image semantic/style/identity QA
  -> selected keyframe + motion plan
  -> multiple LTX candidates where risk warrants
  -> motion/temporal/story QA
  -> exact EDL mapping each shot to beat/timestamp
  -> full-master multimodal QA
```

A production `ShotPlan` needs, at minimum:

- `beatId`, source sentence IDs, `t0`, `t1`, and coverage purpose;
- entities, locations, era, wardrobe/props, and continuity state;
- channel StyleDNA and episode genre constraints;
- literal scene content, motion/action chronology, camera behavior, lighting, and negative constraints;
- source/evidence requirements for factual subjects;
- first/last-frame constraints where transitions or identity continuity require them;
- generation profile, seed, candidate count, fallback policy, and hard QA thresholds.

LTX’s official Image-to-Video guidance says the image establishes appearance and the text prompt should focus on what happens next—motion/action, camera movement, and audio. It also recommends aspect-ratio-matched source imagery and a two-stage generation/refinement workflow ([LTX Image-to-Video guide](https://docs.ltx.video/open-source-model/usage-guides/image-to-video)). Those constraints should be generated from the DP artifact, not improvised from a clipped script paragraph.

### Production QA must be fail-closed and shot-aware

Current QA is useful for gross structural errors but not for the stated quality bar:

- `qa_visual` samples only three frames by default and hard-fails only very low scores.
- Full-watch mode is opt-in and still sparsely samples the final.
- FFmpeg validation largely checks long black segments; tool errors can pass.
- Vision calls can pass as “skipped” when credentials, frames, or provider calls are unavailable.
- Image grading errors return a perfect-looking skip score.
- Deterministic critic assertions block, while story/identity/vision assertions are mostly advisory.
- The local Novita video worker checks duration and freeze fraction, allows substantial freezing, and defaults to non-strict QA.
- Completion markers are treated as success without parsing their failure lists.

“Unavailable” must never mean “pass” for a required quality gate. A production master should be rejected if the required grader cannot run.

Use three layers:

1. **Asset QA:** dimensions, decode, sharpness/exposure, faces/hands/text artifacts, identity, era/genre/style, beat adherence, factual constraints.
2. **Shot QA:** motion amount, freeze, warping, camera adherence, temporal consistency, start/end identity, semantic adherence throughout the shot, audio/visual coherence where model audio is used.
3. **Master QA:** exact duration, narration coverage, shot-to-beat alignment, transitions, repeated footage, captions, loudness, factual provenance, originality, disclosure, title/thumbnail promise, and channel StyleDNA.

Sample every shot at semantically meaningful points and sample every transition; do not infer a 10-minute master from three frames. Store all scores and reasons against the artifact. Calibrate thresholds on a Golden evaluation set and require human approval until false-pass rates are measured.

## “A Dying Art” forensic result

The inspected master exists and is a substantial artifact: approximately 240.8 seconds, 2560×1440, and 556 MB. Its contact sheet is visually coherent and maintains a convincing 1920s-noir direction. That visual success should be preserved.

However, it is not proof of an autonomous reusable system:

- `story.py` manually authors the approximately 100-shot narrative. The AI planner in `crew.py` has no caller in this path.
- The planner input does not use lyric timestamps even though a Whisper transcript exists elsewhere in the workspace.
- Assembly aligns broad song sections and nearby beats, not words, lyrics, or semantic events.
- Render logs report all expected clip assets eventually existing, while final editing uses only 72 shots and discards roughly 28 planned shots from the middle/rising sections.
- Logs contain severe freeze failures on individual shots; workers can still write completion markers with failed IDs, and monitors only check marker existence.
- Assembly accepts at least 75% of clips, its return result is not treated as the final job truth, and the pipeline can announce completion after partial output.
- The “2K” master is a Lanczos resize from a 1920×1080 base, not native high-resolution generation or model-aware latent upscaling.

The correct conclusion is: the project has a strong human-directed reference episode and useful rendering components. Convert it into a Golden benchmark by freezing the approved shot/story/quality decisions, then require the automated pipeline to reproduce or improve them without the manually authored code path.

## Novita render-plane assessment

There are currently three partially overlapping implementations:

1. The main app’s HTTP wrapper and two unreachable render blocks.
2. `/home/ubuntu/novita-render-infra`, a small hosted Z-Image Turbo image-job scaffold.
3. `/root/ltx-build/novita`, the actual fleet launchers, workers, VPS bridge, and “A Dying Art” pipeline.

The third is the only path that demonstrates substantial GPU video work, but it has conflicting operating modes:

- The legacy orchestrator explicitly requests spot capacity but does not attach the network model cache.
- The newer library/pipeline and the live bridge attach Network Volume when available but hard-code on-demand billing.
- The live bridge defaults to allowing requests if no token is configured, and the inspected service environment did not expose a bridge token.
- Main-app requests default to an unencrypted HTTP bridge URL and do not authenticate.
- Output prefixes are not isolated by immutable job ID, so historical files can satisfy a later job’s output count.
- Static sharding uses the requested fleet size even when only part of the fleet launches, leaving work unclaimed.
- The bridge’s monitor state is in a VPS process and is lost on restart.
- Completion is based on marker existence/output counts rather than expected IDs, parsed failures, leases, or verified artifacts.

### Storage and spot policy

Novita describes its Volume Disk as high-performance but ephemeral and non-persistent across instance restarts. It describes Network Volume as shared storage, while explicitly recommending that important data be backed up offsite because it is not a long-term backup service ([Novita GPU instance overview](https://novita.ai/docs/guides/gpu-instance-overview), [Novita Network Volume guide](https://novita.ai/docs/guides/gpu-instance-quickstart-manage-network-volume)). Therefore:

- **Network Volume:** model weights, compiled kernels, reusable caches, and optionally in-progress local manifests.
- **Instance/Volume Disk:** disposable decode, latent, frame, and FFmpeg scratch only.
- **R2:** immutable job manifests, input assets, checkpointed outputs, QA evidence, and final masters.
- **Convex/Trigger:** tenant/job state, leases, expected artifact IDs, cost, retries, and final status.

Spot must be explicit and testable. There must be no automatic on-demand fallback unless a tenant deliberately selects and authorizes it. A termination or stall should checkpoint, release its lease, and allow a new spot worker to continue.

### Model profiles

The current local still worker runs Z-Image **Base** at 40 steps and CFG 4.0. The separate scaffold uses Z-Image **Turbo**. These are not interchangeable parameter profiles. The official Z-Image repository describes Turbo as an eight-forward-pass distilled model with CFG 0 and Base as the flexible CFG model; official examples use nine scheduler steps for eight Turbo DiT evaluations ([Z-Image official repository](https://github.com/Tongyi-MAI/Z-Image), [Z-Image Turbo model card](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)). If Turbo is the mandated production still model, pin the exact checkpoint and Turbo settings; do not reuse Base’s 40-step/CFG-4 settings.

The active LTX worker is pinned to LTX 2.5 with BF16 weights, FP8-cast inference, CPU offload, and native two-stage spatial refinement. Production profiles must remain explicit and must never silently fall back in model, precision, resolution, or GPU class:

| Profile | Purpose | Required behavior |
|---|---|---|
| Draft | Cheap prompt/coverage test | Quantized or distilled is allowed, watermarked as draft, never silently promoted. |
| Production | Final normal shot | Pinned LTX 2.5 BF16 profile with 640×352 stage one and native 2× refinement to 1280×704; no silent precision/resolution fallback. |
| Hero | Faces, identity, difficult motion, opening hook | Multiple candidates, stronger continuity references, full semantic/motion QA, and explicit selection. |

The local open-model path must preserve the pinned two-stage geometry and validate the final encoded dimensions, frame rate, generated-audio stream, visual continuity, and render evidence before publication.

## YouTube connector, scheduler, and analytics

### Current state

The upload implementation creates a resumable upload session and supports private/public/scheduled metadata. It is nevertheless a single-operator implementation:

- There is no application session, organization membership, or Convex authorization boundary. The browser supplies an owner ID and Convex functions trust it.
- `/youtube-connect` accepts an arbitrary channel ID without authenticating the initiating user.
- OAuth `state` is the channel ID itself rather than a unique, session-bound, expiring nonce.
- Refresh tokens are stored plaintext.
- The token lookup secret is enforced only if its environment variable exists.
- `upload_draft` falls back to a global `YOUTUBE_REFRESH_TOKEN` when channel lookup fails. In SaaS, this can publish to the wrong customer account.
- Analytics and retention helpers use a global token and cannot prove which channel/account supplied a metric.
- OAuth scopes omit `yt-analytics.readonly` and `youtube.readonly`; current YouTube Analytics query documentation requires authorized analytics access and describes those scopes ([YouTube Analytics query reference](https://developers.google.com/youtube/analytics/reference/reports/query)).
- Scheduling and learning-loop cron registrations are commented out. The scheduler itself defaults to one global owner and a coarse cadence.
- Uploading currently buffers the whole media object into one PUT and does not persist the resumable URL/range for crash recovery.

### Required connector design

1. Add real user authentication, organizations, memberships, and role-based authorization. Convex notes that its deployment endpoints are internet-accessible and shows authorization by calling `ctx.auth.getUserIdentity()` inside functions ([Convex authentication overview](https://docs.convex.dev/auth/overview), [Convex auth in functions](https://docs.convex.dev/auth/functions-auth)). Derive tenant ownership from that identity; never accept it as authority from the client.
2. Store channel connectors in an encrypted token vault, with tenant/channel IDs, granted scopes, token version, last refresh, revocation status, and audit log. Never expose refresh tokens to the browser.
3. Generate a cryptographically random, one-time OAuth state value, bind it to the authenticated session and intended connector, expire it, and verify it at callback. Google’s server-side OAuth guidance explicitly calls for secure random state stored and verified against the user session ([Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)).
4. Request the narrowest scopes incrementally. Add read/analytics scopes only when the user enables analytics. Google recommends encryption at rest for multi-user tokens and narrow/incremental authorization, plus revocation and deletion handling ([Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)).
5. Remove the global-token fallback. Every upload, schedule action, and analytics query must require an active connector for exactly one tenant/channel and record its connector ID in provenance.
6. Implement true chunked resumable upload: persist the `Location` URL, upload chunks, query server status after interruption, resume at the returned byte range, and make finalization idempotent. This is the recovery flow specified by YouTube ([YouTube resumable upload protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)).
7. Add per-tenant timezone, cadence, quota, concurrency, approval mode, content window, and channel-health controls. Use idempotency keys such as `(connectorId, videoArtifactId, publishIntentVersion)`.
8. Keep user control over publishing. YouTube’s developer policies require transparency, channel/visibility clarity, and express user consent before write actions; “one shot” may assemble a channel pipeline automatically, but it must not silently broaden permission into auto-publishing ([YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)).
9. Support synthetic-media disclosure (`status.containsSyntheticMedia`) and made-for-kids selection in the publish intent. YouTube requires disclosure for realistic altered/synthetic content, and the current video API exposes the field ([YouTube altered/synthetic content policy](https://support.google.com/youtube/answer/14328491), [YouTube videos.insert reference](https://developers.google.com/youtube/v3/docs/videos/insert)).
10. Add channel-level originality and repetition audits. YouTube’s monetization rules identify mass-produced, repetitive, generic template content as “inauthentic content,” so swapping topics inside a fixed visual/script template is not a safe channel strategy ([YouTube channel monetization policies](https://support.google.com/youtube/answer/1311392)).

The existing `planWeekAhead` and retention-to-playbook concepts are valuable. Activate them only after metrics are fetched with the correct channel connector and every learned recommendation records the source channel, date range, metric definition, and confidence. YouTube’s retention metrics can expose relative retention and per-position watch ratios; those should feed a versioned experiment/evaluation record rather than mutate a global playbook without provenance ([YouTube Analytics metrics](https://developers.google.com/youtube/analytics/metrics)).

Browser-automating YouTube channel creation should remain an explicitly approved assisted experiment, not a core SaaS flow. It is an external side effect with account/security/policy implications and currently sits behind unauthenticated endpoints.

## Reliability and verification evidence

Checks run against the current dirty worktree:

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run build` | Pass; Next production build completed with 28 routes |
| `npm run test:engine` | Pass |
| `npm run test:assembly` | Pass; hermetic FFmpeg smoke produced a 31-second artifact |
| Source-scoped ESLint | Fail: 102 errors and 1,345 warnings |
| Direct execution of all repository assertion scripts | Two failures: assembly cutover overlay count and timeline-healing provenance |
| CI workflow | Typecheck only in practice; test step prints that no test script exists and skips |

The repository has 17 test-like files but no configured `test` script/test runner. Running Vitest does not constitute a valid suite because these files are self-executing scripts and the project has no compatible alias/config setup. The actionable result is that CI does not execute the available behavioral checks, build, lint, or the two currently failing assertions.

Other operational risks:

- Lint includes generated Trigger output unless scoped, but the source-only lint result is still materially red.
- A passing command or artifact count does not prove a provider job or production alias is healthy.
- Current completion protocols do not distinguish “worker finished” from “all expected artifacts passed QA.”
- Render outputs need immutable job namespaces and content hashes to prevent stale-success contamination.
- Cost accounting needs preauthorization/reservation and reconciliation, not only post-stage totals.

## Sequenced upgrade waves

Durations are engineering estimates for one focused senior team and exclude provider verification wait times. Do not start with more template families; secure and formalize the existing path first.

### Wave 0 — Contain release blockers (1–3 days)

Deliver:

- Remove public unauthenticated access to the live render bridge; require strong service authentication, TLS, allowlisting, rate/concurrency/cost caps, and signed expiring manifests until the bridge is retired.
- Disable all unauthenticated paid/browser/publish endpoints or put them behind an authenticated operator gate.
- Remove global YouTube token fallback and fail closed on connector mismatch or absence.
- Inventory/rotate potentially exposed bridge/provider credentials and add structured security audit events.
- Parse worker failure markers and prohibit “done” when expected artifact IDs are missing or QA failed.
- Make current paused scheduler/learning status explicit in product/UI rather than implying automation is active.

Acceptance gate:

- An unauthenticated internet client cannot launch compute, read connector state, create channels, or trigger uploads.
- A channel upload cannot use any token except its exact connector.
- A render job cannot finish from stale outputs, a partial fleet, or a marker containing failures.

### Wave 1 — Tenant identity and connector foundation (1–2 weeks)

Deliver:

- User/org/membership schema, authenticated Next routes, Convex identity enforcement, RBAC, and tenant-scoped indexes.
- Encrypted connector vault with key rotation, revocation/deletion, audit log, session-bound OAuth state, incremental scopes, and reconnect flow.
- Connector-bound YouTube upload and analytics clients.
- Chunked resumable upload state machine with persisted URL/range and idempotent finalize.
- Per-tenant quotas, cost ceilings, side-effect approvals, and audit events.

Acceptance gate:

- Cross-tenant authorization tests cover every Convex function and paid/external route.
- Fault injection during every upload chunk resumes without duplicate videos.
- A two-account integration test proves uploads, schedules, and analytics never cross accounts.

### Wave 2 — Executable module ABI and Golden compiler (2–3 weeks)

Deliver:

- Versioned schemas for every artifact and configuration surface.
- `ModuleManifest`, no-ambient-read enforcement, side-effect/idempotency/resume metadata, provider profiles, and provenance.
- Capability-based Golden `PipelinePolicy` and deterministic compiler.
- Migration adapter for existing 43 blocks; remove or label catalog-only modules.
- Certification harness that records fixtures, outputs, costs, model/prompt versions, quality scores, and hashes.

Acceptance gate:

- Every configured control reaches a real runtime consumer or is removed.
- Removing/reordering a required crew artifact fails compilation.
- Every pipeline shown as runnable in the UI compiles from its exact persisted manifest.
- No runtime block can access an undeclared artifact.

### Wave 3 — Story/crew artifact spine (2–3 weeks)

Deliver:

- Timed script, narrative beat, shot plan, DP visual spec, EDL, cue sheet, and critic-spec schemas.
- Sentence/word timing and exact beat coverage accounting.
- Continuity ledger for people/entities, setting, era, wardrobe, props, palette, and camera grammar.
- Real role configuration flowing through crew calls.
- Family constraints for Shorts, long form, comic/panel cadence, and generated-video coverage.

Acceptance gate:

- Every narrated second is mapped to an intentional visual/graphic state.
- Every generated shot points to exact source sentences/beats and continuity state.
- Representative family/duration combinations compile and meet format-specific pacing bounds.
- The “A Dying Art” benchmark is planned from lyric timestamps and semantic events without calling the hand-authored `story.py` path.

### Wave 4 — Novita-local spot render plane (2–3 weeks)

Deliver:

- Retire the VPS scheduler/bridge as job truth.
- Signed immutable job manifests and per-run R2 namespaces.
- Novita-local lease-driven coordinator/workers with spot-only provisioning, Network Volume model caches, disposable local scratch, R2 checkpointing, heartbeats, preemption recovery, and verified shutdown.
- Dynamic queue claiming so a partial fleet still completes all work.
- Pinned Z-Image Turbo and LTX 2.5 draft/production/hero profiles; no silent model, precision, step, or resolution fallback.
- Full expected-ID reconciliation and cost telemetry.

Acceptance gate:

- Kill any worker/coordinator mid-job; a new spot worker resumes without lost or duplicate artifacts.
- Provider payload evidence proves every production instance is spot unless an explicitly authorized override exists.
- Cold/warm-cache timings and costs are measured; idle resources shut down automatically and shutdown is verified.
- A failed output remains failed regardless of historical R2 contents.

### Wave 5 — Quality lab and Golden evaluations (2–3 weeks)

Deliver:

- Shot-aware image, video, and master graders with required/fail-closed profiles.
- A versioned Golden corpus covering at least five channel families, hard identities, genre boundaries, text/diagram cases, factual scenes, and motion failure modes.
- Candidate generation/ranking for hero and high-risk shots.
- Regression dashboard for story alignment, identity, genre, freeze/warping, visual reuse, captions, audio, cost, and latency.
- Human-review workflow to label false passes/fails and calibrate thresholds.

Acceptance gate:

- Required-grader outage blocks production certification.
- Known frozen/warped/off-topic/genre-wrong fixtures fail.
- “A Dying Art” automated output meets or exceeds the frozen reference rubric without manual shot code.
- No production profile silently returns a draft/quantized/upscaled substitute.

### Wave 6 — Scheduler and analytics learning loop (about 2 weeks)

Deliver:

- Per-tenant scheduler with timezone, calendar, approvals, quota/concurrency, retry, and dead-letter handling.
- Channel-bound analytics ingestion with provenance and scope health.
- Versioned experiments linking title/thumbnail/hook/visual decisions to outcomes.
- Retention recommendations proposed as playbook changes, evaluated offline, and approved/versioned before activation.
- Synthetic-content and audience metadata in publish intents.

Acceptance gate:

- Multi-account end-to-end test: assemble, approve, schedule, upload, ingest analytics, and recommend an experiment with exact connector provenance.
- Duplicate scheduler ticks cannot duplicate uploads.
- Revoking a connector stops future actions and removes/retains data according to policy.

### Wave 7 — SaaS productization and release (2–4 weeks)

Deliver:

- Billing/usage ledger and tenant budget enforcement before paid stages.
- Privacy policy, OAuth verification package, data export/deletion/revocation, YouTube audit readiness, abuse controls, and incident runbooks.
- CI gates for typecheck, source lint, build, contract tests, engine tests, assembly tests, auth tests, and provider canaries.
- Observability for pipeline state, side effects, connector health, GPU lifecycle, quality regressions, cost, and production deployment aliases.
- Staged beta with publishing approvals on by default.

Acceptance gate:

- No P0/P1 security, account-isolation, publish-integrity, or quality-integrity defect remains.
- Provider deployment and exact production aliases are verified after release.
- Tenant-level SLOs, budget limits, data deletion, and incident recovery are exercised—not only documented.

## Defining the 80% one-shot target

“80% one shot” needs a benchmark, not an impression from one successful channel.

Build a frozen suite of at least 30 channel briefs across narrated stock, generated documentary, music/loop, comic, Shorts, and whiteboard formats. Include new niches, conflicting constraints, multiple languages, 30-second through 20-minute targets, and connector/schedule variations.

A case counts as one-shot only if:

- the channel spec and first production pipeline compile without a human editing the graph or code;
- every selected module is certified and all required Golden capabilities are present;
- the first episode completes without manual provider reruns or artifact substitution;
- story/beat coverage, format bounds, identity, genre, originality, and technical QA pass;
- cost and latency stay inside the approved envelope;
- any upload goes to the exact selected connector with correct visibility, disclosure, and schedule;
- the operator may approve/reject publication, but does not repair the pipeline.

Recommended release thresholds:

| Metric | Gate |
|---|---:|
| Pipeline compile success | ≥95% of benchmark briefs |
| Full one-shot success | ≥80% |
| Cross-account publication errors | 0 |
| Required QA unavailable-but-passed | 0 |
| Narration-to-visual beat coverage | ≥95%, with 100% mapped |
| Stale/duplicate/missing render artifacts accepted | 0 |
| Silent model/precision/resolution fallback | 0 |
| P0 security or destructive side-effect defects | 0 |

## Recommended first ten implementation tickets

1. Lock down and then retire the unauthenticated live Novita bridge.
2. Remove global YouTube token fallback and add connector-ID provenance to every YouTube call.
3. Add authenticated tenant derivation to Next and Convex; deny client-supplied ownership authority.
4. Implement encrypted connector storage and secure one-time OAuth state.
5. Parse render completion manifests by expected artifact ID and fail on partial/failed QA.
6. Define `ModuleManifest`, artifact schemas, and an undeclared-read detector.
7. Turn Golden spine into a capability policy compiled into every production pipeline.
8. Add `TimedScript -> NarrativeBeat[] -> ShotPlan[] -> DPVisualSpec[] -> EDL` as the generated-video backbone.
9. Replace the VPS/on-demand render path with a Novita-local spot, Network Volume, lease, and R2-checkpoint proof of concept.
10. Put build, source lint, all assertion scripts, auth isolation, and contract tests into CI; fix the two current behavioral failures.

## Final architectural position

Do not rewrite the platform. Keep Convex, Trigger, the block runner, the deterministic designer, R2, and the useful assembly/crew components. The highest-leverage change is to make the promises already represented in the UI—Golden, modular, crew-driven, resumable, account-specific, and quality-gated—true as executable contracts.

The order matters:

```text
secure tenant/connector boundary
  -> executable module and Golden contracts
  -> timed story/crew artifacts
  -> Novita-local spot render plane
  -> fail-closed calibrated QA
  -> scheduling and analytics learning
  -> SaaS release
```

Adding more modules before those contracts will increase the number of impressive-looking combinations while decreasing the probability that any combination is safe, explainable, and repeatable.
