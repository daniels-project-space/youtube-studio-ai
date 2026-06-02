# YouTube Studio AI — Redesign & Build Plan

Status: design doc (2026-06-02). Scope chosen: **full archetype set** (lofi + essay + crime + narrated + shorts + meditation), **fully-autonomous** AI channel-package builder, real-data-everywhere UI. Built on the existing block engine + Convex + Trigger + R2 + vault — no new infrastructure.

---

## 0. Audit summary (what's real today)

**Frontend is ~85% real already.** Overview, Channels, Channel-detail, Runs, Run-detail (live pipeline + logs), Library are wired to live Convex data. The "placeholder" feeling has three causes, not a fake UI:

1. **Analytics & SEO are empty** — their tasks (`stats-refresh`, `research`) have never run in the cloud (the pipeline ran via `trigger.dev dev` on the VPS, so scheduled cloud tasks never fired).
2. **No channel hub** — channel detail is config-only (no image, no $/video, no analytics/library/SEO tabs).
3. **No create-channel flow**; Settings is a stub.

**Backend capabilities mostly already exist** — most battle-tested in `/home/ubuntu/autostudio` (legacy Python). The current app has the Lofi (Template C) blocks; the rest is a port, not an invention.

| Capability | Current app | autostudio (VPS) | Plan |
|---|---|---|---|
| Competitor/market research | ✅ `competitor_research` | ✅ | activate |
| Thumbnail (concept→Flux→Vision QA) | ✅ `thumbnail_gen` | ✅ | keep |
| Title screen | ✅ `intro_card` (Remotion) | ✅ | keep |
| SEO tags | ✅ `metadata_optimized` | ✅ | + description |
| Length check | ✅ ffprobe | ✅ | make hard gate |
| Cost accuracy | ✅ cost wiring (shipped) | partial | surface in UI |
| Analytics tracking | ⚙️ `stats-refresh` (dormant) | partial | activate |
| Narration / TTS | ❌ | ✅ `pipelines/tts.py` (Fish Audio + voice routing) | port |
| Script generation | ❌ | ✅ essay/crime pipelines (Gemini) | port |
| Hook | ❌ | ✅ crime.py | port (conditional) |
| Stock footage | ❌ | ✅ Pexels/Openverse | port (conditional) |
| Visual QA + auto-retry-fix | basic `qa_light` | ✅ `video_verifier.py` (weighted, re-runs failed stage) | port (upgrade) |
| Cuts / b-roll timeline | simple ffmpeg | ✅ Remotion timeline | port (conditional) |
| Channel image | ❌ | ❌ | new (tiny Flux block) |

Vault already holds every key: `pexels, fish-audio, elevenlabs, kits, gemini, anthropic, replicate, fal, serpapi, youtube, openai, …`.

**Security:** `autostudio/config.json` on the VPS has ~9 live API keys in plaintext → rotate + move to vault during the port (Stage 4).

---

## 1. Architectural spine (the reliability/simplicity decision)

One engine, one data model, one secrets store. Everything is a **block**; a channel is a **declarative package**.

- **Block contract (exists):** `{ id, consumes[], produces[], paid?, run(ctx) → patch }`. The engine validates the `consumes/produces` graph (topological, fails loud), preflights budget+keys, runs in order, persists a `runStage` per block (status/timing/cost/inputs/outputs/error), enforces the per-run **budget ceiling**, and supports per-block idempotency keys. (Cost rollup + ceiling shipped this session.)
- **A channel = identity + an ordered `pipeline[]` of blocks** (already stored on the channel record). "Add a channel with pipeline blocks" = choose blocks.
- **Conditional features are data, not code.** Hook/script/narration/footage are simply *present-or-absent blocks* in `pipeline[]`. The graph validator guarantees a runnable order or refuses.
- **Archetypes = named preset block-lists + default params + QA profile + voice + thumbnail style.** (Maps 1:1 to autostudio's `PIPELINE_PROFILES`.)
- **The UI = reactive Convex queries** over the same tables. No new data plane. Reuse existing components.

New capability = port a lib into `src/lib/*.ts` + wrap a thin block that reuses `convexSink` (stages+cost), `runLogSink`, `bootstrapSecrets` (vault), R2 storage, and the `COST_PATCH_KEY` cost mechanism. **That is the only pattern.**

---

## 2. Block registry (full set)

Legend: ✅ exists · ↘ port from autostudio · 🆕 new. `paid` blocks report cost via `COST_PATCH_KEY`.

### Research / planning
| Block | consumes → produces | Provider | Notes |
|---|---|---|---|
| `competitor_research` ✅ | (niche) → nicheIntel (Convex) | YouTube Data API + Gemini | weekly cache |
| `topic_select` ✅ | () → topic | Gemini | dedupe vs `topicMemory` |
| `script_gen` ↘ | topic, nicheIntel → script{sections, narrationText, beats} | Gemini 2.5-Flash | conditional (narrated types) |
| `hook_craft` ↘ | script → hook | Gemini | conditional; can fold into `script_gen` via param |
| `scene_planner` ✅ | topic|script → scenes, sceneMusicPrompt | Gemini | drives visuals |
| `qa_script` ↘ | script → scriptApproved | Claude Sonnet | optional pre-render critique, retry≤3 |

### Asset generation (paid)
| Block | consumes → produces | Provider | Archetypes |
|---|---|---|---|
| `keyframes` ✅ | scenes → f1/f2 stills | Higgsfield Flux (hostless) | AI-visual (lofi) |
| `loop_clips` ✅ | keyframes → clips | Higgsfield Kling | lofi loop |
| `stock_footage` ↘ | script/scenes → footageClips[] | Pexels/Openverse | narrated/essay/crime |
| `broll_clips` ↘ | scenes → brollClips[] | Kling/LTX | narrated b-roll |
| `narration_tts` ↘ | script, hook → narrationKey | Fish Audio (+edge-tts fallback) | all narrated; voice from identity |
| `music` ✅ | topic → musicKey | Mureka/Suno | all |
| `upscale` ✅ | clips → upscaled | Topaz (Replicate) | optional |

### Assembly / post
| Block | consumes → produces | Tool | Archetypes |
|---|---|---|---|
| `assemble` ✅ | loopUnit, music → video | ffmpeg | lofi (loop-under-audio) |
| `timeline_assemble` ↘ | narration, footage/broll, script → video | Remotion timeline | narrated (narration-synced cuts + text) |
| `intro_card` ✅ | video → video(+intro) | Remotion | title screen, optional |
| `length_check` 🆕 | video → lengthOk | ffprobe | hard gate (±tolerance → fail) |

### Quality
| Block | consumes → produces | Provider | Notes |
|---|---|---|---|
| `qa_visual` ↘ (replaces `qa_light`) | video → qaReport | Gemini Vision | per-archetype weighted criteria; on fail, **re-run only the failed stage** (≤3) |

### Metadata / publish
| Block | consumes → produces | Provider | Notes |
|---|---|---|---|
| `metadata_optimized` ✅ | topic, nicheIntel → title, tags, description | Claude/Gemini | add `description` |
| `thumbnail_gen` ✅ | f1/keyframe|footage, title → thumbnailKey | Claude concept → Flux → Gemini QA | |
| `upload_draft` ✅ | video, title, tags, desc → youtubeVideoId | YouTube OAuth | private draft |
| `notify` ✅ | watchUrl → notified | Telegram | |

### Channel-setup (not per-video)
| Block | consumes → produces | Provider | Notes |
|---|---|---|---|
| `channel_image` 🆕 | identity(palette,style) → imageKey, bannerKey | Flux | run once at package build |

---

## 3. Archetypes (preset pipelines)

Each is a named preset: `block-list + default params + QA profile + voice + thumbnail style`. Stored as code presets (`src/engine/archetypes.ts`) and copied onto the channel's `pipeline[]` at creation (so a channel can diverge later).

- **lofi-ambient** (current Template C): `topic_select → scene_planner → keyframes → loop_clips → upscale → music → metadata_optimized → assemble → intro_card → length_check → qa_visual → thumbnail_gen → upload_draft → notify`
- **narrated-essay**: `competitor_research → topic_select → script_gen → qa_script → scene_planner → narration_tts → stock_footage → broll_clips → timeline_assemble → intro_card → length_check → qa_visual → thumbnail_gen → metadata_optimized → upload_draft → notify`
- **crime-narrative**: essay + `hook_craft` (after script) + tension-pacing QA profile + footage-heavy.
- **narrated-generic**: essay without hook, lighter footage.
- **shorts**: short `script_gen` (+hook) → `narration_tts` → vertical `stock_footage`/`broll_clips` → fast-cut `timeline_assemble` → captions → `qa_visual`(shorts profile) → metadata/thumbnail/upload.
- **meditation/ambient-narrated**: long-form, calm voice, slow footage, minimal cuts.

Conditional blocks (hook/script/narration/footage) appear only in the archetypes that need them — the engine handles ordering via the graph.

---

## 4. Fully-autonomous AI channel-package builder

A Trigger task `build-channel-package` triggered from one **seed** (a niche/idea string). No human review mid-flight; the channel is created `active` (or `draft`) and the user edits afterward in the hub. Each step persists an artifact (reuse `runStages`/`runLogs` under a synthetic setup-run) so it's observable and debuggable, and the same live progress UI shows it.

Steps (all autonomous):
1. `competitor_research(seed)` → nicheIntel.
2. **Concept synthesis** (Claude/Gemini): from seed + nicheIntel → `{ name, niche, persona, styleGrammar, palette[], topicPool[], bannedWords[], cadence, archetype (chosen from the set by content type), thumbnailIdentity, voiceId (from voice map) }`. Validated against a JSON schema (StructuredOutput).
3. `channel_image` → Flux avatar + banner from palette/style → R2 (`imageKey`, `bannerKey`).
4. **Pipeline assembly**: copy the chosen archetype's preset block-list + defaults onto the package.
5. `createChannel(package)` → channel row; image keys attached.
6. Optional: kick one **dry/validation run** (no paid blocks, or a single cheap test) to confirm the pipeline graph is valid before first real run.

Reliability: deterministic step sequence; every output a stored, schema-validated artifact; fully editable in the hub after. "Ensure it's the right one" = the validation run + the editable hub, not a mid-flight gate (per the fully-autonomous choice).

---

## 5. Data model deltas (Convex)

Additive, back-compat (all optional):
- `channels.identity`: already has `voiceId`, `niche`, `thumbnailIdentity`. Add `imageKey?`, `bannerKey?` (R2 channel art).
- `channels`: `archetype?: string` (which preset built it; `template` stays).
- `runs`: nothing required (cost already there). Add `kind?: "video" | "setup"` to reuse run/stage machinery for the package builder.
- `videos`/assets: store `description` in asset meta (already loose). Surface `costTotal` from the run (already present) as **$/video**.
- **Stripped now (2026-06-02):** `costLedger` (redundant — `runStages.cost` IS the per-provider ledger), `schedules`, `oauthTokens`, `settings` — all were 0-reference speculative tables. Re-introduce per-stage **with the real fields** when the feature is actually built (don't carry schema you don't use).
- `seoDatabank.channelId` (exists, optional): use it for **per-channel** SEO.

No new tables required (setup-run reuses `runs`/`runStages`/`runLogs`). Channel art rides `channels.identity.imageKey/bannerKey` — no separate table.

---

## 6. Frontend / IA plan

Reuse existing components (StatCard, Chart, VideoGrid, Lightbox, LivePipeline, LogConsole, EmptyState, Skeleton) and the warm-glass theme tokens. No new design system.

- **Channel card** (the "Rainy Neon Lofi / Done / Template C / 6 runs" example, done right): generated **image**, identity chip, **real KPIs** (runs · videos · **$/video** · subs sparkline), status. Every number backed by a query — no floating placeholders.
- **Channel hub** `/channels/[slug]` → tabs, all linked + real:
  - **Overview**: banner + avatar + identity + KPIs + recent runs + budget burn.
  - **Analytics**: `channelTrend` (subs/views/revenue) + **cost-per-video** + cost-by-provider (from `runStages`).
  - **Library**: `listVideos(channelId)` with $/video on each card.
  - **SEO**: per-channel niche intel + databank (`getNiche`/`getDatabank` by the channel's niche) + view-estimate.
  - **Pipeline**: the channel's block-list (read + reorder/toggle/param-edit → `updateChannel`).
  - **Identity**: form editing persona/palette/voice/niche/thumbnail style/image (regenerate image).
- **Overview / Library / Analytics / SEO (global)**: existing pages; fill with real data once tasks run; add cost + budget cards.
- **Create Channel**: a single **seed input** → triggers `build-channel-package` → live progress view (reuse run-detail style) → redirect to the new hub.
- **Settings**: YouTube OAuth connect, budget defaults, model routing. (Replaces the stub.)
- **Runs / Run-detail**: keep (already strong).

---

## 7. Staged rollout (deliverables + acceptance)

### Stage 0 — Cutover + activate real data (fast, highest perceived impact)
- Finish VPS→cloud cutover (stop `trigger.dev dev` on VPS; cloud is sole runner).
- Schedule + fire `stats-refresh` and `research` in cloud prod (provision any missing env; vault hydration already verified).
- **Accept:** Analytics, SEO, Competitors pages show real numbers; no empty states on populated niches.

### Stage 1 — Channel hub + image + cost
- `channel_image` block + backfill images for existing channel(s).
- Channel-hub tabs (Overview/Analytics/Library/SEO/Pipeline/Identity); channel-card redesign with image + KPIs + $/video.
- Surface `run.costTotal` as $/video everywhere; budget-burn card.
- **Accept:** every channel has art; clicking a channel → real per-channel analytics/library/SEO; accurate $/video shown (matches summed `runStages.cost`).

### Stage 2 — Autonomous AI package builder
- `build-channel-package` Trigger task (research → concept(schema) → image → pipeline → createChannel → validation run).
- Create-Channel UI (seed → live progress → hub).
- **Accept:** typing a niche produces a complete, valid, editable channel with art + pipeline; a validation run passes the graph check.

### Stage 3 — Content blocks port (full archetype set)
- Port libs → `src/lib/`: `tts.ts` (Fish Audio + voice routing + pause injection), `footage.ts` (Pexels/Openverse), `videoVerifier.ts` (Gemini weighted QA + fix loop), `timeline.ts` (Remotion timeline), `scriptGen` (Gemini).
- New blocks: `script_gen`, `hook_craft`, `narration_tts`, `stock_footage`, `broll_clips`, `timeline_assemble`, `qa_visual` (replaces `qa_light`), `qa_script`, `length_check`.
- `src/engine/archetypes.ts` presets for all archetypes; register blocks in `engine/blocks.ts`.
- Pricing entries in `pricing.ts` for new paid blocks (TTS/footage/broll) so the budget ceiling stays accurate.
- **Accept:** a narrated-essay channel renders end-to-end in cloud (script→hook→TTS→footage→timeline→QA-retry→thumbnail→upload); per-block cost recorded.

### Stage 4 — Reliability polish + security
- `length_check` + `qa_visual` as **hard gates** (fail the run, don't ship off-spec).
- Budget warnings in UI (run.costTotal vs channel.budget); cost-by-provider chart.
- Revenue analytics graphed (`channelAnalytics.estimatedRevenueUsd`).
- **Rotate `autostudio/config.json` keys** → vault; remove plaintext.
- **Accept:** off-spec renders are blocked with a clear reason; no plaintext keys on the VPS.

---

## 8. Reliability & glue-minimization principles

- **Off-the-shelf only:** Convex (data + reactivity), Trigger (orchestration + scheduling), the block engine (validation/preflight/cost/idempotency), Remotion (intros + timelines), ffmpeg (assembly, baked into image), vault (secrets), R2 (media). No new services; every provider key already exists.
- **One pattern for every capability:** port lib → thin block → reuse `convexSink`/`runLogSink`/`bootstrapSecrets`/`COST_PATCH_KEY`. No bespoke wiring per feature.
- **Config over code:** archetypes, voice routing, QA profiles, conditional features are data/presets — not `if` branches in the runner.
- **Fail loud, retry narrow:** `qa_visual` re-runs only the failed stage (cost-bounded); preflight refuses invalid graphs/budgets before spending.
- **Hostless:** all blocks run in the Trigger image (Higgsfield now baked; ffmpeg baked; Remotion via build extension in Stage 3). The VPS is retired.

---

## 9. Cost model (rough, per video; tune `pricing.ts`)
- lofi-ambient: ~$1.0–1.5 (2× Kling clips dominate + Topaz + music).
- narrated-essay/crime: ~$0.4–1.0 (TTS ~$0.05–0.15 + stock footage free/cheap + optional b-roll Kling; no loop-clips).
- shorts: ~$0.2–0.5.
The budget ceiling (shipped) aborts before overspend; `$/video` shown in UI is the summed `runStages.cost`.

---

## 11. Anti-bloat & no-monolith discipline

Success metric for the migration = **less code in the new app than the capability count would suggest**, not more. v1 (autostudio + passive-income) is the cautionary example: a monolith of overlapping pipelines, SQLite + manual migrations, bash glue, plaintext keys, and a dashboard server. We port the *capabilities*, not the architecture.

### Already stripped from the current app (this session)
- Dead **Real-ESRGAN** image-upscaler path in `replicate.ts` (`upscaleImage`/`runUpscale`/`REAL_ESRGAN_VERSION`) — superseded by Topaz `upscaleLoopUnit`, zero references (~85 lines).
- Four **0-reference tables** from `schema.ts`: `costLedger`, `schedules`, `oauthTokens`, `settings`.
- (Minor, optional) move echo smoke-test blocks out of the production registry into the test.

### No-monolith rules for every port
1. **One capability = one block + one thin `src/lib/*.ts` wrapper.** No god-modules, no "pipeline" classes that know about every stage. The engine is the only orchestrator.
2. **Reuse, don't re-implement:** `convexSink` (stages+cost), `runLogSink`, `bootstrapSecrets` (vault), R2 `storage.ts`, `COST_PATCH_KEY`, idempotency keys. A new block adds ~1 lib + ~1 block file and nothing else.
3. **Config over code:** archetypes, voice routing, QA criteria, conditional features are **data/presets**, never `if (channel === 'crime')` branches in the runner.
4. **Collapse v1's 13 pipelines → shared blocks + archetype presets.** The overlap (crime/essay/narrated/meditation differ mostly in params + which blocks) becomes one block set + preset lists. This is the single biggest de-bloat.
5. **Delete-as-you-port:** when a capability is live + verified in cloud, remove the legacy that it replaced (see decommission list). Don't let v1 and v2 both exist long-term.
6. **No new infrastructure.** If a need seems to require a new service/table/daemon, first prove it can't be a block + an existing table.

### Do NOT carry over from v1 (leave the bloat behind)
- SQLite + hand-written migrations → Convex.
- `dashboard/server.js` (separate Express dashboard) → the Convex-reactive UI we already have.
- Bash orchestration / cross-venv `PYTHONPATH` glue → Trigger tasks.
- Plaintext `config.json` keys → vault (and rotate, §security).
- CrewAI multi-agent script critic subprocess → a single Sonnet `qa_script` call.
- `creator_footage.py` yt-dlp channel scraping → SaaS-unsafe; use Pexels/Openverse + AI b-roll only.
- Shotstack cloud render ($3–6/video) → ffmpeg/Remotion in the Trigger image.
- The 9 hardcoded live API keys in `autostudio/config.json` → **rotate immediately**, never replicate that pattern.

### v1 decommission checklist (post-port, on the VPS — flag, don't delete prematurely)
Only after each capability is ported + a cloud render verifies it:
- [ ] Stop `trigger.dev dev` on the VPS (cutover) — the VPS stops being a runner.
- [ ] Rotate `autostudio/config.json` keys → vault; delete the file.
- [ ] Archive/remove `/home/ubuntu/passive-income/*` legacy apps once nothing references them.
- [ ] Remove `/home/ubuntu/ghibli-*`, `/home/ubuntu/app-factory` clutter if unused.
- [ ] Keep `/root/autostudio-migration/audit/*.md` (the spec docs are cheap reference); drop the rest of `autostudio` after the port.

These are surfaced for your approval — I will not delete the porting reference until its capability is live in v2.

## 10. Open decisions (for later)
- Footage mix per narrated archetype: stock-only vs stock+AI-broll default.
- Whether `hook_craft` is its own block or a `script_gen` param.
- Channel art: avatar+banner only, or also per-video thumbnail style presets.
- OAuth: single YouTube account (current) vs multi-account onboarding in Settings.
