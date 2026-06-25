# 02 — VISUALS (footage / b-roll sourcing + selection)

Research date: 2026-06-24. Scope: the VISUALS step of an automated YouTube factory — sourcing b-roll, matching it to script lines, and placing it with shot-grammar. Engine today = `src/lib/footagecraft.ts` (491 LOC).

---

## NOW

`footagecraft.ts` is a standalone `castFootage(brief, queries, targetSec, …)` module. Pipeline:

1. **QUERIES** — `buildFootageQueries()`: Gemini turns topic + real narration + the channel's locked Style-DNA visual world (`setting / colorGrade / motifs`) + avoid-list into concrete, filmable, on-brand **keyword** search terms (nature-locked when the channel demands).
2. **SOURCE** — federated **4K-only** search across Pexels + Pixabay concurrently (`footage.ts`), Coverr excluded.
3. **CAST** — per query, concurrently: stream-download top candidate(s) (global semaphore so 4K clips don't blow memory) → **multi-frame relevance + watermark/logo gate** (samples start/mid/end via `grabFrame` + `geminiVisionLocal`), judged against this video's theme + visual world + grade + `healHints`. `RELEVANCE_MIN = 7`.
4. **COVER** — keep casting (primary → evergreen fallback → ledger-relaxed → ranked spares) until body length covered; **dedup within video AND across past videos** via the caller's R2 ledger (`usedClipIds`).

Infra rule: footage never touches dev/VPS — only the Trigger-worker temp dir (for ffmpeg) + R2. Pure of Convex/R2 (caller owns persistence). Deps: `GEMINI_API_KEY` + ≥1 provider key. Also carries a **motion doctrine** (`FootageDoctrine`) per niche — calm channels reject shaky/drone/fast clips.

**Gaps vs. premium:** matching is **keyword search + a vision gate**, not semantic embedding ranking — the gate is pass/fail relevance, it does not *rank* the candidate pool by closeness to the line. No shot-grammar (every clip is treated the same — no establishing vs detail vs cutaway). No color/continuity scoring across the cut sequence. No AI-generated footage fallback when stock is thin. No semantic dedup (id-based only — a near-duplicate clip with a new id slips through). Vertical = `orientation` flag only (provider 9:16 search), no smart reframe of landscape footage.

---

## AFTER (target state)

A ChannelProfile-driven Mastra tool that, per script **beat**, returns a **ranked** clip with a **role** (establishing / detail / cutaway / transition), chosen by **semantic similarity** (embedding of the narration line vs. embeddings of candidate clips), filling a **coverage contract** (every beat covered, shot-roles balanced, no two adjacent clips visually identical), with **stock+generated mixed intelligently** (generate only the beats stock can't cover or the hook), color/continuity-aware ordering, channel-wide semantic dedup, and saliency-based vertical reframe. Cheapest reliable path reuses **Convex vector search** + a cheap text/multimodal embedding API.

---

## HOW LEADERS DO IT

Universal pattern across **Pictory, InVideo AI, Revid, AutoShorts, ShortGPT, Vadoo, Argil, ClipsMate**: LLM segments script into scenes → LLM generates **per-scene search keywords** → query a stock API (overwhelmingly **Pexels**, sometimes Storyblocks/Getty) → take top result → assemble + caption + VO. It is **keyword search, not embedding match** — the LLM does the "semantics" by writing better queries; the stock provider's own search ranks.

- **Pictory** — scene-by-scene; matches each summary sentence to its 10M+ clip library (Getty + Storyblocks); "AI Studio" tab adds prompt-to-image/prompt-to-video as a per-scene override → **hybrid**. (https://pictory.ai/pictory-features/script-to-video, https://pictory.ai/academy/how-to-turn-script-into-video-pictory-ai)
- **InVideo AI** — single-prompt → scenes → stock matched per scene; explicitly warns the **first/hook clip** sets the tone and is the one to swap. (https://vidailab.com/invideo-ai-youtube-shorts/)
- **Revid** — topic/URL → script → auto B-roll; reviewers note the **stock library gets repetitive on niche topics** (exactly the dedup problem). (https://nickthrolson.com/revid-ai-review-2026-is-it-the-best-ai-video-generator-for-faceless-channels/)
- **AutoShorts** — analyzes script, auto-matches stock; the open-source clone (`moloygoswami/AI-Youtube-Shorts-Generator`) asks Gemini for **two visual keywords per scene** → pulls **two Pexels 9:16 clips** for an A/B split mid-scene (cheap "shot variety" hack), avatar injected mid-roll. Critics call the rigid "stock + AI voice + centered caption" formula recognizable **"AI slop" within 2 seconds** — the thing we must beat. (https://jungminai.com/autoshorts-ai-review/)
- **ClipsMate** — GPT-4o generates per-scene keywords → Pexels; scraped page images first, then Pexels, then DALL·E 3 as fallback (a clean **stock→generate fallback ladder**). (https://clipsmateai.com/smart-scene-matching)
- **Generated-first / hybrid tier** (Higgsfield, Veo, Sora-class pipelines) is used for hooks and beats stock can't cover; cost makes it selective, not wholesale.

**The real semantic-match tier** (what separates premium) is documented outside the consumer tools: embed query + embed footage into a shared space, rank by cosine similarity (CLIP/SigLIP frame embeddings or video-native embeddings), store in a vector DB. Runway uses image/style embeddings for "find footage like this reference." (Zilliz: https://zilliz.com/ai-faq/how-do-ai-video-tools-use-vector-search ; AWS Nova Multimodal video search: https://aws.amazon.com/blogs/machine-learning/power-video-semantic-search-with-amazon-nova-multimodal-embeddings/)

---

## TOOLS

### Stock providers
| Provider | API | Cost | When |
|---|---|---|---|
| **Pexels** | free, key, generous | free | Default. What every tool uses. 4K + 9:16 search. (https://www.pexels.com/api/) |
| **Pixabay** | free, key | free | Second federated source (we already use it). |
| **Mixkit** | no public API | free | Curated, higher-quality look; manual/scrape only. |
| **Storyblocks** | subscription API | ~$30–100/mo unlimited DL | Volume + quality jump over free; Pictory backbone. (https://www.storyblocks.com) |
| **Pond5 / Envato** | API, per-clip or sub | paid | Premium/niche coverage when free libraries repeat. |

### Semantic match (embeddings + vector)
| Tool | Cost | When |
|---|---|---|
| **OpenAI `text-embedding-3-small`** (1536-d) | **$0.02/1M tok** | Safe default for text↔text (line vs clip *caption/tags*). Matryoshka-truncatable. (https://developers.openai.com/api/docs/models/text-embedding-3-small) |
| **Jina embeddings v3** (1024-d) | $0.02/1M tok | Best price/quality text; same price as OpenAI small, higher MTEB. |
| **Voyage `voyage-3.5-lite`** (512-d) | $0.02/1M, 200M free | Cheap, 200M free tokens — effectively free at our volume. |
| **Jina CLIP v2** | usage / self-host | True **text→image** match (89 langs, Matryoshka 64–1024d). For embedding actual frames vs the line. (https://jina.ai/models/jina-clip-v2/) |
| **Cohere `embed-v4`** | $0.10/1M | Single model embeds text + images together (no CLIP modality bias). (https://docs.cohere.com/docs/embeddings) |
| **Voyage `multimodal-3`** | $0.12/1M tok + $0.60/1B px (200M tok + 150B px free) | Video-native: each frame = an image; avoids CLIP's same-modality bias. (https://docs.voyageai.com/docs/multimodal-embeddings) |
| **Convex vector search** | $0.50/GB store, ~$0.10/1k query-GB | Store + ANN search where our data already lives. Dims **2–4096**, ≤16 filter fields, ≤4 indexes/table, ≤256 results, `q.eq/q.or` filters (filter by channelId). (https://docs.convex.dev/search/vector-search) |

### Shot / scene tooling
| Tool | Cost | When |
|---|---|---|
| **PySceneDetect 0.7** | free (OSS) | Split a long stock clip into discrete shots so we pick the *best sub-shot*, not a whole noisy clip; `ContentDetector` (HSV) for cuts, `AdaptiveDetector` for camera motion, `split_video_ffmpeg`. Also: storyboard frames for embedding. (https://www.scenedetect.com/cli/) |
| **FFmpeg** | free | Frame extraction (already used via `grabFrame`), splitting, reframe crop. |

### AI b-roll generators (image-to-video, draft-cheap → upgrade winners)
| Model | API $/sec | Notes | When |
|---|---|---|---|
| **Veo 3.1 Lite** | ~$0.05 | 720p/1080p, no 4K/refs | Cheapest draft generation. |
| **Runway Gen-4 Turbo** | ~$0.05 | i2V, fast | Cheap drafts / Ken-Burns alt. |
| **Kling 3.0 Std** | ~$0.08 | i2V, camera controls, native 4K (Pro) | Cinematic b-roll, multi-shot narrative. |
| **Luma Ray3.14** | ~$0.20 (50cr/5s draft) | fast draft → Ray3 HDR final | Draft/final split workflow. |
| **Veo 3.1 Std** | ~$0.40 | 4K + native audio, 8s max | Hero/hook final renders only. |
| **Higgsfield** | ~$0.10/sec (orchestration layer; bundles Sora2/Kling/Veo/Seedance) | We already have a `higgs` CLI | Single entry to many models. |
| **i2V / Ken-Burns** | n/a (FFmpeg) or any i2V | Free pan/zoom on a still vs. paid motion | When a still image is on-theme but a moving clip isn't available. |

Pricing source: https://apostle.io/blog/true-cost-of-ai-video-2026 , https://segwise.ai/blog/image-to-video-app-ads-workflow , https://www.gmicloud.ai/en/blog/ai-video-platform-comparison . **Rule: draft on $0.05/sec tiers, re-render only the hook/winners on $0.40+ tiers.**

### Vertical reframe
| Tool | Cost | Notes |
|---|---|---|
| **Adobe Firefly Reframe API** | paid | Semantic Subject Lock (focal keywords persist across cuts); saliency fallback; OTIO sidecar. (https://developer.adobe.com/audio-video-firefly-services/guides/reframe/) |
| **OpusClip ReframeAnything / Premiere Auto Reframe** | sub | Subject-tracking 16:9→9:16. Reference behavior. |
| **Self-host saliency crop** | free | OpenCV saliency / face-track + FFmpeg `crop` — cheapest path for our pipeline. |

---

## IMPLEMENTATION (our stack — Mastra tool + ChannelProfile)

Keep the strong parts (federated 4K search, vision watermark/logo gate, ledger dedup, motion doctrine). Add four layers:

**1. Semantic ranking (replace "first passing clip" with "best-ranked clip").**
After SOURCE returns N candidates per beat, embed the **narration line** and each **candidate** (its provider tags/title + an optionally captioned mid-frame) into one space; cosine-rank; THEN run the existing vision gate on the top-K only. Cheapest reliable path:
- Text-only first cut: `text-embedding-3-small` or `voyage-3.5-lite` ($0.02/1M; Voyage 200M free) on `line` vs `clip.tags+title`. Near-free.
- True visual match (worth it for hooks/premium beats): **Jina CLIP v2** or **Voyage multimodal-3** on `line` vs the clip's mid-frame (we already extract frames). Voyage multimodal free tier (150B px) covers us for a long time.
- Store clip embeddings in **Convex vector search** (dims match model: 1536 / 1024 / 512) with `filterFields:["channelId"]` so dedup + reranking are channel-scoped. This reuses infra we already run.

**2. Coverage contract (the thing that kills "random montage").**
Define beats from the script (sentence/clause segmentation, same as scriptcraft). The tool must return a result satisfying:
- every beat has ≥1 clip (existing COVER loop),
- shot-role balance: ≥1 establishing (wide, query-tagged `aerial/wide/landscape`) per section, detail/cutaway interleaved, no >2 same-role in a row,
- adjacency rule: no two consecutive clips with cosine sim > 0.92 (semantic dedup, not id dedup) and not the same dominant color/scene (cheap: compare mid-frame avg-color / CLIP sim),
- hook beat gets the highest-scored or a generated clip.
Emit a `coverage` report object (beats, role per beat, gaps) so the caller can heal.

**3. Shot grammar via PySceneDetect.** For long stock clips, split with `ContentDetector`, embed each sub-shot, pick the sub-shot whose embedding is closest to the line — gives premium "this exact moment" matching instead of a whole drifting clip. Tag sub-shots wide/medium/close from crop/face-area heuristics → fills the role contract.

**4. Generate-when-stock-fails ladder (ClipsMate pattern).** primary stock → evergreen fallback → ledger-relaxed → **i2V/Ken-Burns on a matched still** → **draft generation (Veo Lite / Runway Turbo / `higgs`)** → upgrade only the hook to Veo Std/Kling Pro. Gate generated clips through the same vision/relevance pass.

**5. Vertical.** Keep provider 9:16 search as primary; when only landscape exists, saliency-crop (OpenCV + FFmpeg) or Firefly Reframe with the channel's focal keyword. Drive target ratio from ChannelProfile.

ChannelProfile fields to drive it: `visualWorld`, `visualAvoid`, `natureMode`, `motion` doctrine (already in `FootageBrief`), plus new `shotGrammar` (role mix), `embeddingModel`, `generateBudgetSec`, `targetRatio`.

---

## TOP 3 MOVES

1. **Semantic re-rank before the gate.** Embed line vs candidate (text-3-small / voyage-lite now; Jina-CLIP-v2 / Voyage-multimodal for visual), cosine-rank, gate top-K. Store vectors in Convex vector search (channelId filter). Turns pass/fail into best-of — the single biggest quality lift, ~free.
2. **Coverage + adjacency contract.** Beat-level coverage with shot-role balance (establishing/detail/cutaway), and a **semantic** adjacency rule (cosine > 0.92 = reject) replacing id-only dedup. This is what kills the "AI slop in 2 seconds" montage look.
3. **Generate-when-stock-fails ladder.** Ken-Burns/i2V → draft gen on $0.05/sec tiers (Veo Lite / Runway Turbo / existing `higgs`) → upgrade only hook to premium. Removes the niche-repetition wall Revid/AutoShorts hit, at controlled cost.
