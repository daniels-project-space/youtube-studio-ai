# 05 — VERIFY + SHIP (automated video/thumbnail QA → upload + distribution)

Research date: June 2026. Scope: the two terminal stages of the YouTube factory — (A) **VERIFY** (is this artifact good enough to publish?) and (B) **SHIP** (upload + multi-platform distribution). Sources cited inline.

---

## NOW

**VERIFY (current):** Per-artifact vision QA. Thumbnail checked at real 168px browse size against scraped top competitors; the critic's `ValidationSpec` enforced (`engine/golden.ts` verify stage: `qa_visual` + `qa_refine`); failures route back through a self-heal loop (`engine/healer.ts` — defect catalog → block-that-owns-it mapping → heal hints that harden the gate) instead of shipping. A black-segment/length guard exists (`probe()` in `lib/ffmpeg.ts`; `verifyRemotion.ts` checks `hasVideo` + size). **Gap:** QA is vision-only — no objective A/V metrics (no loudness/blackframe/freeze/VMAF), so audio defects (silence, hot levels) and temporal defects (freeze, flicker) are invisible to the gate.

**SHIP (current):** `lib/youtube.ts` — resumable `videos.insert` (`uploadType=resumable&part=snippet,status`), `privacyStatus` forced to `private` on paused channels (operator flips to public). `lib/ayrshare.ts` — `crosspost()` posts an R2 media URL to TikTok/IG/etc. Telegram budget/completion alerts. **Gaps:** (1) **No idempotency** on either upload — a Trigger retry can double-upload; (2) Ayrshare call has no schedule, no dedupe, no post-publish feedback; (3) no thumbnail A/B wiring.

---

## AFTER

**VERIFY = a typed QA gate.** Three layers, all emitting structured defects the Director self-heals:
1. **Objective metrics (cheap, deterministic, no LLM):** ffmpeg/ffprobe — `blackdetect`, `freezedetect`, `silencedetect`, `ebur128` (EBU R128 loudness/true-peak), optional `libvmaf` vs the pre-master reference. Hard pass/fail thresholds.
2. **Vision rubric (LLM):** structured JSON rubric per frame-type (Claude/Gemini vision), with a per-item **confidence threshold** below which the item routes to human review rather than guessing.
3. **Competitor benchmark:** thumbnail vs scraped top-N at 168px (already have); add click-prediction (persona focus-group or Vision-API scorecard) **before** upload.

Each failed check emits `{ defect, ownerBlock, hint, severity }` → existing `healer.ts` catalog → bounded re-render of the owning block only.

**SHIP = idempotent, scheduled, multi-platform, feedback-looped.** Stable idempotency key per logical upload (e.g. `video:<convexId>`) on the Trigger task AND a content hash check before `videos.insert`; resumable session persisted so a retry resumes bytes, not restarts; YouTube native Test & Compare for thumbnail A/B; multi-platform fan-out (Ayrshare/Blotato) with per-platform `scheduledTime`; post-publish analytics (CTR, watch-time share, retention) loop back to topic/thumbnail selection.

---

## HOW LEADERS DO IT

- **Rubric autoraters (state of the art):** Google's **Gecko** (Vertex AI Gen AI Evaluation Service) decomposes the prompt into question-answer pairs and scores generated image/video against them — interpretable, customizable, used to benchmark Imagen. ByteDance **UVE** uses MLLMs as unified evaluators across 15 fine-grained aspects (tv_alignment, flickering, motion_naturalness, temporal_visual_quality…). **VideoScore** (TIGER-AI-Lab, EMNLP'24) is a trained scorer (Mantis-8B) reaching 77.1 Spearman vs humans — a drop-in proxy metric.
- **Closed-loop self-heal (exactly the target pattern):** `moshem-a/genai-video-eval` — Gemini auditors critique a Veo "artist", translate visual failures into **quantitative prompt corrections**, pick a clean (non-"poisoned") starting frame from a region with no detected flags, and re-generate in-flight. Falls back to text-only when the whole clip is flagged.
- **Production QA pipeline (real numbers):** Kalviumlabs audited 200 videos in ~3h at **89.3% agreement** with a senior reviewer. Key lessons: **Claude beat GPT-4o on reliable structured-JSON output**; three rubric items were **impossible from frames alone** → split out to `ffprobe` (audio loudness) + duration checks on frame timestamps; **confidence < 0.75 → human review** (~12% routed back). This validates the hybrid (metrics + vision) split.
- **Broadcast QC tradition (Baton/Vidchecker-style, now OSS):** `rendiffdev/rendiff-probe` (19 QC categories, 121 params, 26 ffmpeg analyzers — blackdetect/freezedetect/cropdetect/idet/ebur128/astats), `GouthamUKS/QC_Scanner` (TC-rejection-style checks: legal black YMIN<16 / white YMAX>235, LUFS, A/V sync), `Eyevinn/audio-qc` + `Clem-J/loudness-check` (EBU R128 JSON reports with correction hints like "Raise level by +1.4 dB").
- **Multi-platform ship:** n8n + **Blotato** is the dominant AI-video fan-out pattern (one POST per platform, same `text`/`mediaUrls`, Google-Sheet `ReadyToPost`→`Finished` flag = poor-man's idempotency). **Ayrshare** (13+ platforms, MCP server), **upload-post** (12 platforms, free tier, built-in ffmpeg, cheaper than Ayrshare), **Postiz** (per-platform `settings.__type` schema).
- **Thumbnail A/B:** YouTube native **Test & Compare** (rolled out broadly 2026) — up to 3 variants, traffic split simultaneously, **winner = highest watch-time share** (not CTR), needs ~1–2k+ impressions/variant for significance, auto-applies winner. **No public API** — Studio-only (drive via Playwright on Studio, or generate variants via template API e.g. Imejis and upload manually). Pre-publish click-prediction via Mavera persona focus-groups or Vision-API scorecards.

---

## TOOLS

| Tool | Use | Notes / URL |
|---|---|---|
| ffmpeg `blackdetect` | black-frame guard | `d`(min dur, def 2.0) · `pic_th`(0.98) · `pix_th`(0.10); sets `lavfi.black_start/end`. https://ffmpeg.org/ffmpeg-filters.html |
| ffmpeg `freezedetect` | frozen/stuck-frame guard | `n`(noise, def -60dB) · `d`(def 2s); sets `lavfi.freezedetect.freeze_start/duration/end` |
| ffmpeg `silencedetect` | dead-air guard | `n=-50dB:d=5`; sets `lavfi.silence_start/end` |
| ffmpeg `ebur128` | loudness / true-peak (EBU R128) | `-filter_complex ebur128 -f null -`; target -14 LUFS (YouTube normalizes ~-14), TP ≤ -1 dBTP. ITU-R BS.1770 |
| ffmpeg `libvmaf` | objective quality vs reference | `libvmaf=log_fmt=json:log_path=out.json`; needs `--enable-libvmaf`. https://github.com/Netflix/vmaf |
| rendiff-probe / QC_Scanner | broadcast QC wrapper (121 params) | https://github.com/rendiffdev/rendiff-probe · https://github.com/GouthamUKS/QC_Scanner |
| VideoScore / UVE / Gecko | learned/MLLM AIGV scorers | https://github.com/TIGER-AI-Lab/VideoScore · https://github.com/bytedance/UVE · https://cloud.google.com/blog/products/ai-machine-learning/evaluate-your-gen-media-models-on-vertex-ai |
| Claude / Gemini vision | rubric QA (structured JSON, conf threshold) | Claude best at consistent JSON (Kalviumlabs); https://www.kalviumlabs.ai/blog/video-auditing-with-ai-automated-qa-pipeline/ |
| YouTube Data API `videos.insert` | upload | resumable, 1600 units (≈6 uploads/day on default 10k); hidden "Video Uploads per day" 429 cap (#2753). https://developers.google.com/youtube/v3/docs/videos/insert · https://developers.google.com/youtube/v3/guides/uploading_a_video |
| YouTube Test & Compare | thumbnail A/B (watch-time share) | Studio-only, no API. https://support.google.com/youtube/answer/16391400 |
| Ayrshare / Blotato / upload-post / Postiz | multi-platform fan-out + scheduling | https://www.ayrshare.com/docs/apis/post/post · https://help.blotato.com/api/publish-post · https://www.upload-post.com · https://docs.postiz.com/public-api/posts/create |
| Trigger.dev idempotency | never double-upload | `idempotencyKeys.create()`, scope `global`, `idempotencyKeyTTL`. https://trigger.dev/docs/idempotency |

---

## IMPLEMENTATION (Mastra tools + Trigger durable tasks + Convex state)

**1. `lib/avqc.ts` — objective A/V QC (no LLM, deterministic).**
One ffmpeg pass over the master: `-vf "blackdetect=d=0.2:pix_th=0.10,freezedetect=n=-55dB:d=1" -af "silencedetect=n=-45dB:d=1.5,ebur128=peak=true" -f null -`. Parse stderr for `black_start/freeze_start/silence_start` + integrated `I` LUFS + `TPK` true-peak. Optional second pass `libvmaf` vs the pre-grade reference (`log_fmt=json`). Return `QcReport { blackSegments[], freezeSegments[], silenceSegments[], lufs, truePeakDb, vmaf?, pass }` with thresholds: LUFS in [-16,-12], TP ≤ -1, no black/freeze > 0.5s mid-video, no silence > 2s.

**2. Map QC failures into the existing healer.** Extend `engine/healer.ts` defect catalog with `qc_black`, `qc_freeze`, `qc_silence`, `qc_loud` → owner block (compose/narration/master) + heal hint (e.g. "loud: re-master with loudnorm I=-14:TP=-1"). The vision `qa_visual` block stays; `avqc` runs *before* it as a cheap pre-filter (fail fast, save vision tokens).

**3. Mastra tools (typed, per-account):**
- `qcVideoTool` → wraps `lib/avqc.ts`, returns `QcReport`.
- `qaVisionTool` → existing thumbnail/frame rubric, now emits `{ defects[], confidence }`; `confidence < 0.75` → `needsHumanReview`.
- `shipYoutubeTool` (idempotent), `crosspostTool` (idempotent), `thumbnailAbTool` (Playwright→Studio Test&Compare).

**4. Trigger durable tasks (idempotency = the headline fix):**
- `verify-av` task: `idempotencyKeys.create('verify-av:'+videoId, {scope:'global'})`; caches `QcReport` in Convex.
- `ship-youtube` task: idempotency key `ship-yt:<videoId>`; **also** persist returned `youtubeId` to Convex *before* anything else and short-circuit if already set (defence-in-depth vs the 429 upload cap — content-hash + state check, per uploadfile.pro pattern). Persist the resumable `Location` URL so a retry resumes bytes.
- `crosspost` task: idempotency key `crosspost:<videoId>:<platform>`, fan-out one child per platform (so one platform failing doesn't re-post the others), `scheduledTime` staggered.

**5. Convex state (extend schema — `qaRubric` field already exists at schema.ts:82):**
Add to the video doc: `qcReport: v.optional(v.any())`, `qaConfidence: v.optional(v.number())`, `needsHumanReview: v.optional(v.boolean())`, `youtubeId`, `youtubeUploadedAt`, `crosspostIds: v.optional(v.array(v.string()))`, `abTestId/abWinner`, `publishMetrics` (CTR, watchTimeShare, retention) for the feedback loop. `youtubeId` presence = the idempotency source-of-truth.

**6. Feedback loop:** existing `retentionAnalyst.ts`/`seoReoptimize.ts` already pull analytics — feed `publishMetrics` + A/B winner back into topic + thumbnail-prompt selection (close the loop the leaders close).

---

## TOP 3 MOVES

1. **Add the objective A/V gate (`lib/avqc.ts`) in front of vision QA.** One ffmpeg pass = blackdetect + freezedetect + silencedetect + ebur128. Deterministic, free, catches the entire class of audio/temporal defects vision misses, and saves vision tokens by failing fast. Wire failures into the existing `healer.ts` catalog.
2. **Make ship idempotent.** Trigger `idempotencyKeys` (global scope) on `ship-youtube` + persist `youtubeId` to Convex before side-effects and short-circuit if set. Per-platform idempotency keys on crosspost. This is the single highest-risk current gap (retry → double-upload against a hidden ~6/day cap).
3. **Close the loop: confidence-gated human review + thumbnail A/B + metrics feedback.** Vision items `<0.75` confidence → `needsHumanReview` (don't guess); auto-run YouTube Test & Compare (3 template-generated variants) on publish; feed watch-time-share winner + retention back into topic/thumbnail selection.
