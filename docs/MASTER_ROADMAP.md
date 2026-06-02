# YouTube Studio AI — Master Roadmap (v2)

The phased plan to turn the current pipeline into a **great, automatic, reliable**
autonomous YouTube engine. Companion to `PIPELINE_V2_PLAN.md` (audit, gap map,
tool research). This doc is the build sequence.

## What this app is for (the target)

An autonomous engine that, per channel, **on a schedule and with minimal human
touch**:
1. picks a fresh, on-identity topic (never repeating for channels that shouldn't);
2. writes a genuinely original, on-brand script with a real point of view;
3. produces correct per-niche **SEO**, a **great thumbnail**, **on-topic verified
   imagery**, a Remotion **title card + music bed**, and **captions**;
4. stays **compliant** (originality, synthetic-content disclosure, licensing) so it
   is never demonetized;
5. is **reliable** (resumable, retrying, quota-aware, observable);
6. **learns** from analytics — winning topics/hooks/thumbnails bias future videos.

Quality is driven by **two agents that critique and enhance together**: a
**Producer** (generates) and a **Director** (vision-capable critic) looping
generate → critique → revise until a quality bar is met.

## Architecture (locked: hybrid)

| Layer | Choice |
|---|---|
| Execution runtime | **Trigger.dev** (baked image: ffmpeg + Chromium + higgsfield CLI; machine sizing; idempotency) — keep |
| Pipeline DAG | existing **block engine** (validate consumes/produces, cost ceiling, Convex sink) — keep |
| Agent loops | **Mastra** (`Agent` + workflow `.dountil` + scorers), authored *inside* creative blocks — **two levels, no overlap** |
| Observability | **Langfuse** (native Mastra exporter) |
| Producer model | Gemini 2.5 Flash (cheap, fast) |
| Director model | Claude Sonnet (vision critic, separate/stronger) |
| State | Convex (channels, runs, topicMemory, assets, analytics, **embeddings**) |

## Integrated tool stack (chosen so they work together)

| Job | Tool | Status |
|---|---|---|
| Thumbnail (text) | **Ideogram 3.0** | new |
| Thumbnail (subject/brand) | FLUX 1.1 / Nano-Banana Pro | new (opt) |
| Thumbnail text overlay | **Satori + @resvg/resvg-js + sharp** | new |
| Image relevance gate | **Gemini 2.5 vision** (+ Replicate CLIP pre-rank) | new |
| Entity verify | Wikidata/Wikimedia + Gemini vision | new |
| Footage | Pexels (scored+deduped, v1 method) | upgrade |
| SEO keyword/outlier | YouTube Data API SERP + **TubeLab API** (+ DataForSEO/Trends opt) | new (Stage 0) |
| Captions/SRT | **WhisperX forced-align (GPU)** + aeneas; AssemblyAI fallback | new |
| Originality self-dedup | **OpenAI `text-embedding-3-small`** cosine gate | new |
| Script plagiarism spot | Originality.ai API | new (opt) |
| Analytics (learning) | **YouTube Analytics API** (OAuth) | new (Stage 0) |
| Cross-post (later) | Ayrshare | later |
| TTS / Music | Fish Audio / Mureka | keep |
| Agent obs | Langfuse | new |

Rough cost/video (narrated, with loops, cap 3 iters): TTS ~$0.05 + music ~$0.30
+ images/thumbnail ~$0.10 + LLM loops ~$0.05–0.15 + captions ~$0 (GPU) ≈
**$0.50–0.65**. The critic loops add cents, not dollars.

---

## Phases

Each phase is independently shippable, validated, and committed. ★ = uses the
Producer↔Director loop.

### Phase 1 — Agent foundation + Director topic chunk
**Why first:** the loop primitive is the spine every creative chunk reuses, and
the non-repeating identity topic is an explicit requirement.
- Stand up **Mastra hybrid** scaffold + **Langfuse** tracing + model wiring
  (Producer=Gemini, Director=Sonnet). Verify it bundles in the Trigger image
  (mark external if needed, like Remotion). *Fallback:* if Mastra bundling
  fights us, ship the loop as a plain helper behind the same interface and adopt
  Mastra internals next — blocks don't change.
- Reusable **`produceAndCritique`** loop primitive (threshold + max-iter cap +
  carry-prior-critique / Reflexion; deterministic facts computed in code).
- ★ **`topic` chunk**: Producer proposes identity-aligned candidates excluding
  full history; Director ranks for fit/freshness/CTR honoring bannedWords;
  **hard no-repeat enforced in code**; per-channel `policy` param
  (`no_repeat` | `prefer_fresh`). Migrate the 2 live channels.
- **Done when:** topic chunk returns a fresh on-identity topic for The Quiet
  Stoic, never repeats, traced in Langfuse; cheap LLM test (no render).

### Phase 2 — Correct SEO + captions + chapters
**Kills the hardcoded-lofi bug; cheap high-value wins.**
- ★ **`seo` chunk**: title/description/tags from the actual script + identity
  (+ SERP/TubeLab when Stage 0 live; LLM-from-script now). Director critiques
  CTR + on-brand; **length & keyword-position checked in code**. No lofi unless
  lofi.
- **Captions/SRT** via WhisperX forced-alignment on the GPU (we have script +
  audio) → `captions.insert`. **Chapters** as description timestamps.
- **Done when:** Quiet Stoic ships philosophy SEO + SRT + chapters; lofi stays
  lofi; a real render verifies.

### Phase 3 — Visuals that make sense + great thumbnail
- ★ **`visual_plan`**: Director shot list mapping each script beat → required
  visual (entity portrait / b-roll concept / concept art).
- ★ **`imagery` relevance gate**: Pexels scored+deduped (v1) + CLIP pre-rank +
  Gemini-vision relevance pass; **entity verify** (Wikidata + vision); re-source
  on reject.
- ★ **`thumbnail`**: Ideogram text-first (or Nano-Banana + Satori overlay) +
  per-niche **style guide** (Gemini-vision analysis of top competitor
  thumbnails — needs Stage 0) + Director vision critique (legible-small, CTR,
  on-brand, **matches the video**).
- **Done when:** sampled frames + thumbnail pass the Director; entity images
  verified; no off-topic footage.

### Phase 4 — Compliance gates (before ANY auto-publish)
**Existential — protects against channel-wide demonetization.**
- **Embedding self-dedup gate**: embed script/title (`text-embedding-3-small`),
  cosine vs prior uploads (Convex vector store), **block > ~0.9**.
- **POV/originality layer**: Director enforces a genuine viewpoint + structural
  variation vs recent uploads (anti-"inauthentic").
- **Synthetic-content disclosure classifier**: flag realistic real-person/
  event depiction → set disclosure; **block** realistic synthetic media on
  sensitive topics (health/news/elections/finance).
- **License/attribution ledger**: per-asset source+license+attribution; auto
  credits block in the description; never rely on Content ID for AI music.
- **Done when:** a near-duplicate upload is blocked; disclosure set when due;
  descriptions carry attributions.

### Phase 5 — Reliability (before unattended runs)
- **Resume/checkpoint**: skip completed stages on retry; paid blocks (TTS/music/
  images/thumbnail) as child tasks with idempotency keys → no double-spend.
- **Systematic retry/backoff** per block (429/5xx) + **YouTube quota guard**
  (10k units/day budget across statsRefresh/research/upload/captions) +
  **concurrency cap** (no parallel-render OOM).
- **Metrics**: success rate, per-block cost/latency trends, failure taxonomy
  (Langfuse + Convex), alerts beyond Telegram-on-fail.
- **Done when:** a killed run resumes without re-spending; transient API errors
  self-heal.

### Phase 6 — Automatic operation
- **Per-channel generation scheduler** (Trigger `schedules.task` on cadence,
  humanized jitter — no metronomic pattern).
- **Scheduled publish** (`status.publishAt` drip) + per-channel
  **auto-publish vs human-approve** switch + an approval queue in the hub.
- **Auto playlists** by series/topic.
- **Done when:** a channel produces + (auto-publishes or queues for approval) on
  cadence with zero manual steps.

### Phase 7 — Learning loop (needs Stage 0 OAuth)
- **OAuth Analytics ingest**: `relativeRetentionPerformance`, averageViewPct,
  traffic sources, thumbnail CTR (verify Jan-2026 metric live); ≥72h eval lag.
- **Performance → Director feedback**: winning topics/hooks/thumbnails/titles
  bias future generation. **TubeLab** outliers for topic discovery.
- **Done when:** the Director's choices measurably shift toward high-retention
  patterns over a few cycles.

### Phase 8 — Growth (optional)
- Cross-post Shorts → TikTok/Reels via **Ayrshare**; localization (multi-lang
  captions/titles/dubs).

---

## Dependencies & gates
- **Stage 0** (YouTube Data API key + OAuth) gates: SERP-driven SEO + thumbnail
  style guide (Phase 3), and all of Phase 7. Phases 1–2 (LLM-from-script SEO),
  4, 5 work **without** it.
- **Phase 4 must precede Phase 6** (don't auto-publish without compliance gates).
- **Phase 5 should precede Phase 6** (don't run unattended without resume/retry).
- Phases 1–5 are buildable now on the existing infra.

## Sequencing summary
1 → 2 → 3 (quality core) · 4 (compliance) · 5 (reliability) · 6 (autonomy) ·
7 (learning, after Stage 0) · 8 (growth).
