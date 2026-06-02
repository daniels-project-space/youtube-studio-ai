# Generation Pipeline v2 — quality overhaul (audit + plan)

Goal: great thumbnails, correct per-niche SEO, images that provably match the
content — driven by a **two-agent Producer↔Director loop** (generate → critique →
enhance), composed as **Mastra workflow chunks** running inside Trigger.dev.

---

## 1. Audit — why output is weak today

| Area | Current code | Problem |
|---|---|---|
| **SEO** | `intelligenceBlocks.ts metadataOptimized` L175 | Title hardcoded `"<topic> — Lofi Beats to Relax / Study To 🎧"` + lofi tags + lofi description for **every** archetype. Gemini override only fires if a competitor databank exists (needs YouTube API = Stage-0-blocked). So "The Quiet Stoic" (philosophy) ships lofi SEO. |
| **Thumbnail** | `thumbnailGen` claude_flux | Claude concept → Flux (text-free) → ffmpeg `drawtext` (DejaVu) → Gemini QA. Generic typography; degrades to title_card which **throws for narrated** (no `f1Url`). No per-niche style learning. |
| **Images** | `stockFootage`, `entityImagery` | Pexels: takes the **first** hit per query. Wikimedia: takes the **first** image (could be the wrong person). No relevance check at selection. `qa_visual` only samples 3 frames **after** assembly and gates at score<4 — too late, too lenient. |
| **Quality loop** | `qa_visual` | **Gates/fails only** — never feeds fixes back to regenerate. One-shot artifacts. |

## 2. What v1 (autostudio) did better — port these

- **Footage scoring** (`pipelines/footage.py`): scores Pexels by resolution (0–40), duration/trim-room (0–30), bitrate, and **dedups via `exclude_ids`** — picks the *best*, not the first.
- **Thumbnail style guide** (`intelligence/thumbnail_analyzer.py`): Gemini-Vision analyzes the **top-performing competitor thumbnails per niche** → a structured style guide (colors, text style, composition, face/expression, technique) that conditions generation.
- **Ideogram text-first thumbnailer** (`strategies/thumbnail/ideogram.py`): "text reads exactly …" prompts, Impact-style, ≥40% frame — ~90–95% text accuracy vs Flux. Flux as fallback.
- **Sonnet vision critic + QA-fix-hints** (`providers/sonnet_critic.py`, `_qa_fix_hints`): a multimodal critic returns per-category verdicts; the pipeline **re-runs flagged stages with the critique injected** (Reflexion). This is the two-agent enhance loop, already proven in v1.
- **Concept imagery sourcing** (`providers/concept_imagery.py`): Wikimedia over-fetch + filter by mime/size before download.

## 3. Prebuilt tools — wire vs skip (2026 research)

**Thumbnail generation**
- **Ideogram 3.0** — cheapest reliable text-in-image (~95% accuracy, $0.03–0.09). One call. → **default for text thumbnails.**
- **Google Nano-Banana Pro (`gemini-3-pro-image`)** — best subject+text + up to 14 brand-reference images ($0.13–0.24). → premium subject thumbnails.
- **FLUX 1.1 pro** — best photoreal subject, weak text → background only, overlay text yourself.
- **Compositing for pixel-perfect on-brand text:** **Satori + @resvg/resvg-js** (pure Node, custom fonts, ~$0) or Bannerbear; finish with **sharp** → exact 1280×720.
- **Skip:** vidIQ/Pikzels/Thumbnail.ai (no real API), Canva Connect (enterprise-gated), Remotion-for-thumbnails (heavier than Satori).

**Image / clip relevance**
- **Gemini 2.5 Flash vision** — explainable 0–100 relevance + entity-confidence JSON, ~free/check → **the gate.**
- **Replicate CLIP** — cheap bulk cosine pre-rank of many candidate clips before the LLM gate.
- **Entity verify:** Wikidata/Wikimedia reference + Gemini-vision confirm (+ Google Vision Web Detection for famous subjects).

**SEO data**
- **YouTube Data API v3** — SERP scrape (top titles/descriptions/views) as LLM context. (`relatedToVideoId` dead; competitor tags hidden.) Needs the Stage-0 key.
- **Volumes (optional, paid):** DataForSEO (API-first, YT labs) or Keywords Everywhere (cheap). **Google Trends API** (free alpha) for seasonality.
- **Skip:** vidIQ/TubeBuddy (no API). **De-prioritize tags** — minimal ranking weight in 2026; title + description-first-150-chars + thumbnail + retention dominate.

**Agent framework:** **Mastra** (`@mastra/core`) — `Agent`, `createTool` (zod), `createWorkflow`/`createStep` with `.then/.parallel/.branch/.dountil`, `createScorer` evals, suspend/resume.

## 4. Architecture — two agents, Mastra chunks, Trigger runtime

**Runtime split:** Trigger.dev stays the execution layer (baked image: ffmpeg + Chromium + higgsfield CLI; machine sizing; idempotency; Convex sink). **Mastra authors the pipeline** as a workflow-per-archetype; the workflow runs *inside* the Trigger task.

**The two agents (shared across creative chunks):**
- **Producer** (generator, tool-using) — makes the artifact.
- **Director** (critic, vision-capable, separate/stronger model = Claude Sonnet) — scores vs rubric + brand identity + **objective signals computed in code** (char counts, keyword position, resolution, length, CLIP score), emits structured per-aspect critique + concrete fix instructions.

**Enhance loop (Reflexion via Mastra `.dountil`):**
```
generate(using prior critique) → critique(structured) → repeat
stop when  score ≥ threshold  OR  iteration ≥ cap (default 3)
```
Rule (anti-score-hacking): deterministic facts are *computed*, never LLM-graded; only subjective quality (hook, CTR appeal, on-brand, relevance) goes to the Director.

## 5. The pipeline as chunks (Mastra steps)

Creative chunks run the Producer↔Director loop (★); deterministic chunks run once (▷).

**Strategy**
1. ▷ `research` — niche intel: YouTube SERP scrape + (opt) keyword volumes + Trends + **competitor-thumbnail style guide**. Cached ~weekly.
2. ▷ `topic` — pick/dedup from pool, biased by trend/outlier signal.
3. ★ `script` — Producer drafts; Director critiques hook/pacing/on-brand/factual-hedging. (replaces script_gen + qa_script)

**Assets**
4. ▷ `narration` — TTS (voice per identity).
5. ★ `visual_plan` — Director-guided shot list: maps each script beat → required visual (entity portrait / b-roll concept / concept art). *The missing "make images make sense" step.*
6. ★ `imagery` — per shot: source candidates (Pexels **scored+deduped** like v1 / Wikimedia / Flux), then **relevance gate** (CLIP pre-rank → Gemini-vision pass; entity verify via Wikidata+vision). Re-source on reject.
7. ▷ `music` — generate bed (built).

**SEO + Thumbnail**
8. ★ `seo` — Producer drafts title/desc/tags from research; Director critiques CTR + **code-checked** keyword-in-first-40 & length + on-brand (no lofi unless lofi). *Fixes the hardcoded-lofi bug.*
9. ★ `thumbnail` — Producer: concept → **Ideogram text-first** (or Nano-Banana subject + Satori text) → Director vision critique (legible-small, CTR, on-brand vs style guide, **matches the video**). *The great thumbnail.*

**Assemble + final**
10. ▷ `assemble` — Remotion title card + `composeWithIntro` (built).
11. ★ `final_qa` — Director samples frames; checks structural/length + **cross-artifact coherence** (script ↔ visuals ↔ thumbnail ↔ SEO). Drives fixes, not just fail.
12. ▷ `upload` (private) + `notify`.

## 6. Phasing

- **P1 — stop the bleeding (no Mastra):** niche/script-aware `metadata` (kill hardcoded lofi); footage **scoring + dedup**; **relevance gate** on footage + entity (Gemini vision); entity verify. Biggest quality jump, low risk.
- **P2 — thumbnail:** Ideogram thumbnailer + per-niche **style guide** from competitor-thumbnail analysis (needs YouTube API → couples with Stage 0); Satori overlay path; narrated fallback fix.
- **P3 — Mastra intelligence layer:** wrap `script`, `seo`, `thumbnail`, `imagery`, `final_qa` as Producer↔Director Mastra workflows invoked from the blocks. Add `visual_plan`.
- **P4 — full Mastra workflow per archetype** + scorers for observability + budget caps per loop.

## 7. Tool inventory (build vs skip)

Build: Ideogram, FLUX/Nano-Banana, Satori+resvg+sharp, Gemini-vision relevance, Replicate CLIP (opt), Wikidata entity verify, YouTube Data API SERP, Trends (opt), DataForSEO/KW-Everywhere (opt), Mastra agents/workflows/scorers, Claude Sonnet Director.
Skip: vidIQ, TubeBuddy, Canva Connect, Remotion-for-thumbnails, heavy tag optimization.

---

# 8. Gap analysis — what else is missing for a GREAT, AUTOMATIC, RELIABLE engine

Status legend: ❌ missing · ◐ partial · ✅ have. Sources: YouTube policy/API research 2026.

## TIER 0 — Existential (policy). Currently ❌ across the board. Must exist before auto-publish at scale.
- **Originality / anti-"inauthentic" gate** ❌ — YouTube's Jul-2025 "inauthentic content" rule + Jan-2026 purge terminate channel-wide for templated, mass-produced, low-variation AI output. Need a per-video gate: each upload materially different in structure/script/angle/assets vs prior uploads, plus a genuine POV/commentary layer (not narrated facts). **The biggest risk; cosmetic quality is moot if the channel is terminated.**
- **Synthetic-content disclosure classifier** ❌ — mandatory label when realistically depicting real people/places/events; block realistic synthetic media on sensitive topics (health/news/elections/finance). Note: no clean public Data API field — may need a UI/RPA step. Faceless AI-voice + generative B-roll on non-sensitive topics generally does NOT require it.
- **Cadence humanization** ❌ — metronomic auto-upload is a detection signal. Jitter timing.
- **License/attribution ledger** ◐ (recordAsset has meta, no license) — per-asset source+license+attribution; auto-render a CC-BY credits block in the description; never rely on Content ID to protect AI music.

## TIER 1 — Great (quality). Planned + cheap wins.
- Niche SEO / great thumbnail / image-relevance / Director-chosen non-repeating topic / Producer↔Director loops — **planned (§5)**.
- **Captions/SRT** ❌ — `captions.insert` (srt/vtt). Accessibility + SEO + retention. Cheap, high value. Generate from the narration script (we have exact timing).
- **Chapters** ❌ — timestamps in description (first must be 00:00, ≥3, ≥10s). Trivial.
- **Hook / first-30s retention** ◐ — retention is the #1 algorithm signal; make the opening a Director-gated artifact.
- **Pronunciation/pacing** ◐ — SSML / name-pronunciation pass for TTS.

## TIER 2 — Automatic (autonomy). Core to "automatic"; mostly ❌.
- **Per-channel generation scheduler** ❌ — nothing auto-triggers a video on cadence today (runs are manual/UI). This is the spine of "automatic." (Trigger `schedules.task` per channel cadence.)
- **Scheduled publish** ❌ — `videos.insert status.publishAt` so uploads drip naturally (ties to cadence humanization) instead of all-at-once.
- **Auto playlists** ❌ — `playlists/playlistItems` organize by series/topic.
- **Publish autonomy switch** ◐ — today stops at PRIVATE draft (safe). Need an explicit per-channel auto-publish vs human-approve gate.
- **Content calendar / series planning** ❌ — beyond single-topic: arcs, recurring formats.

## TIER 3 — Reliable (ops). Needed before unattended operation; mostly ❌/◐.
- **Resume / checkpoint** ❌ — engine runs inline; a failure restarts from scratch and re-spends on paid blocks (TTS/music/images). Need stage checkpointing + skip-completed on resume. (Idempotency keys exist but blocks aren't child-tasks yet.)
- **Systematic retry/backoff** ❌ — only thumbnail retries ad-hoc. Per-block retry policy for transient 429/5xx.
- **Quota/rate management** ❌ — YouTube Data API 10k units/day (search=100, upload=1600, captions=400); budget across statsRefresh + research + upload or hit quota.
- **Concurrency control** ◐ — only machine sizing; need a cap so parallel renders don't OOM/contend.
- **Observability/metrics** ◐ — have run logs; missing success-rate, per-block cost/latency trends, failure taxonomy, proactive alerts beyond Telegram-on-fail.
- **Secret rotation** ◐ — plaintext keys in old config flagged.

## TIER 4 — Learning loop (makes it "great over time"). ❌ — gated on Stage 0.
- **Deep analytics ingest** ❌ — `statsRefresh` gets only surface views/likes via the Data API key. The signals that matter need the **OAuth Analytics API**: `relativeRetentionPerformance`, `averageViewPercentage`, traffic sources, and thumbnail CTR (`videoThumbnailImpressionsClickRate`, added Jan-2026 — verify live). Evaluate on a ≥72h lag.
- **Performance → generation feedback** ❌ — feed winning/losing topics, hooks, thumbnails, titles back into the Director so the engine compounds. This is what turns it from "auto" into "good."
- **A/B test** — Test & Compare is **UI-only (no API)**; can't automate. Note + skip.

## TIER 5 — Growth (optional, later). ❌
- Multi-platform cross-post (Shorts→TikTok/Reels) via **Ayrshare** (one API).
- Localization (multi-language captions/titles/dubs).

## Recommended sequence
1. **Quality core (in flight):** topic (Director, non-repeating) → SEO (niche) → image relevance → thumbnail. + Captions + Chapters (cheap, fold in).
2. **Tier-0 policy gates** before any auto-publish: originality/variation gate + POV layer + disclosure classifier + license ledger.
3. **Reliability:** resume/checkpoint + retry/backoff + quota guard (needed before unattended).
4. **Automatic:** per-channel scheduler + scheduled-publish + auto-publish/approve switch.
5. **Learning loop:** OAuth Analytics ingest → feed performance into the Director (needs Stage 0).
6. **Growth:** cross-post, localization.

---

# 9. Tools per gap (online research) + build-vs-buy

**Build vs buy the whole engine: BUILD.** End-to-end "faceless" platforms (AutoShorts, FlowShorts, Vugola, Nexlev) are UI template-factories with thin/no APIs — and renting a template engine is exactly the "mass-produced" pattern YouTube now demonetizes. Only **Revid.ai** has a real API ($39–199/mo) but it's a black box (no control of archetypes, QA, thumbnail/SEO, models). Verdict: keep building; Revid only as a throwaway A/B baseline if ever wanted. We already own the differentiated layers these hide.

| Gap | Tool pick (top) | API | Cost | Note |
|---|---|---|---|---|
| Captions/SRT | **WhisperX forced-alignment** on our GPU (+aeneas line pass) | self-host | ~$0 | We have the exact script+audio → align, don't re-transcribe. AssemblyAI ($0.15/hr) managed fallback. **Near-term quick win.** |
| **Originality / self-dedup** (Tier-0 compliance) | **OpenAI `text-embedding-3-small`** cosine gate vs prior uploads, **block > ~0.9** | yes | ~$0 | The load-bearing anti-"inauthentic" control — only our own embedding index can judge cross-upload templating. Store vectors in Convex. |
| Script plagiarism spot-check | **Originality.ai** API | yes | ~$15–179/mo | Only on flagged/source-derived scripts, not every video. |
| LLM observability/eval | **Langfuse** | yes (native **Mastra exporter**) | free tier / self-host | Tracing + prompt versioning + eval scoring + cost. Adopt with Mastra. |
| Orchestration | **Stay Trigger.dev** | — | — | TS-native, dedicated compute for ffmpeg/render, durable retries. Inngest/Temporal not justified. |
| Outlier/topic discovery | **TubeLab API** | yes | $29/mo | Only real outlier API (1of10/vidIQ are UI/MCP-only). Feeds the Director's topic + title patterns. |
| Own performance signals | **YouTube Analytics API** (OAuth) | yes | free (quota) | retention/CTR/traffic for the learning loop. Needs Stage 0. |
| Cross-post (later) | **Ayrshare** | yes | paid | One call → TikTok/Reels; supports captions+thumbnail+playlist+schedule. |

Captions + the **embedding self-dedup gate** are the two highest-leverage *new* additions: cheap, buildable now, and the dedup gate is the single best protection against channel-wide demonetization.
