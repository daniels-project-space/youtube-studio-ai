# Assembly / Video Edit + Render — Research

Research date: 2026-06-24. Scope: the ASSEMBLY step of an automated YouTube video factory — footage interleave, beat/chapter cutting, intro/outro/chapter cards, music duck, caption/quote/insert finishing, and final render. Sources are 2025-2026, cited inline.

---

## NOW

Current implementation in `youtube-studio-ai`:

- **`timeline_assemble`** — a 269-LOC imperative "god-block" in `src/trigger/blocks/narratedBlocks.ts`. In one function it: interleaves footage with entities, cuts on beats/chapters, draws chapter + intro + outro cards, ducks music, finishes captions/quotes/inserts, and runs regex-routed self-heal. It reads **9 undeclared store keys** (hidden coupling — no typed contract).
- **Renderer** = raw ffmpeg primitives in `src/lib/ffmpeg.ts` (`concat` / `compose` / `patchSegment`).

Problems: planning logic and rendering logic are fused; no inspectable intermediate artifact; not idempotent/resumable (a partial failure re-runs the whole god-block); per-account behaviour is hardcoded, not parameterized; "self-heal" is regex string-routing instead of a typed plan you can validate.

This is the **MoneyPrinterTurbo / ShortGPT pattern**: a single sequential composition stage where MoviePy+ffmpeg directly assemble clips, subtitles, music. In MoneyPrinterTurbo's own community write-ups the composition stage is called out as "the least AI-interesting and the most operationally fragile — most open issues trace here" (https://mrzacsmith.medium.com/moneyprinterturbo-read-honestly-the-pipeline-pattern-thats-worth-more-than-the-product-ee9112916f18). The fragility is structural: imperative ffmpeg with no separating contract.

---

## AFTER (next-level)

Target architecture (the planned split):

1. **`planTimeline` (pure)** — deterministic function: `(script, footage, beats, chapters, ChannelProfile) -> Timeline/EDL`. No I/O, no ffmpeg, no store reads. Produces a typed, serializable Edit Decision List (every clip, track, in/out, transition, caption, card, audio-duck envelope, reframe crop). This is the **contract**.
2. **`renderTimeline` (pure, idempotent)** — `(Timeline) -> mp4`. Consumes only the EDL. Renders per-segment, content-addressed cache keyed on segment hash, so re-runs skip already-rendered segments. The heavy render is the only durable/long part.
3. **`ChannelProfile`** — per-account config (caption style, pacing preset, card templates, LUT/grade, reframe target, music-duck dB) injected into `planTimeline`. Replaces hardcoded per-account branches.
4. Wrap `planTimeline` as a **Mastra tool** (cheap, fast, inspectable — the agent can read/critique the EDL before committing). Wrap `renderTimeline` as a **Trigger.dev durable task** (long, retryable, checkpointed).

The EDL becomes the seam between "what to cut" (LLM/agent reasoning, cheap) and "how to render" (deterministic compute, expensive). This mirrors what every serious tool below converged on.

---

## HOW LEADERS DO IT

Two camps. The naive camp fuses planning+render; the next-level camp emits an EDL first, then renders.

**Naive / sequential-ffmpeg camp (what we're escaping):**
- **MoneyPrinterTurbo** (harry0703, MIT) — Python service layer (Streamlit + FastAPI). `task.py` orchestrates LLM→keywords→TTS→subtitles→stock(Pexels/Pixabay)→**MoviePy composition→ffmpeg encode**. Composition is sequential; transitions are random/fade/slide; music mixed via an ffmpeg `amix` one-liner; libx264/AAC 1080p out. (https://github.com/harry0703/MoneyPrinterTurbo, architecture: https://www.xugj520.cn/en/archives/ai-video-generation-system-architecture-2.html)
- **ShortGPT** (RayVentura) — notable because it already abstracts editing into an **"Editing Markup Language" (JSON) broken into blocks "comprehensible to LLMs"** via an `EditingEngine`; `ContentShortEngine`/`ContentVideoEngine` go script→render. MoviePy under the hood. This is a primitive EDL — directionally where we're going. (https://github.com/RayVentura/ShortGPT)
- **MoneyPrinter V2** (fujiwarachoki) — MoviePy `combine()`: TTS duration / N images = per-image duration, TextClip captions burned in, bgm mixed low. Pure sequential. (https://fujiwarachoki-moneyprinterv2.mintlify.app/features/youtube-automation)

**EDL-first / cloud camp (next-level):**
- **OpusClip** — pipeline: ingest → LLM "comprehensive understanding" → pick highlight moments → **rearrange into a plan** → polish (dynamic captions, AI-relayout, transitions, CTA). Their reframe is a documented EDL-ish pipeline: subject detection (face/saliency/cursor/diarization) → track across timeline → crop to target ratio. Explicit rule from their API docs: **"reframe first, then add captions"** (caption position shifts otherwise). Has an API + MCP server. (https://www.opus.pro/blog/auto-resize-video-api, https://www.opus.pro/ai-reframe, https://www.opus.pro/api)
- **Submagic** — template (caption look + animations + effects) chosen up front, then auto-caption (98%, 50+ langs) + transcript-driven B-roll insertion with a "frequency slider" + auto-transitions + silence removal + auto-zoom. Template = a profile applied to a plan. (https://www.submagic.co/features/auto-video-editor)
- **Masterselects / Multicam AI** — the cleanest expression of the pattern: Claude is **given only metadata** (motion curves, sharpness, audio levels, timestamped transcript — *no video frames*) and **returns a JSON EDL** of cut decisions (camera, start, end, reasoning). Per-style rule sets (Podcast 3s-min, Music cut-on-beat 1-2s, Documentary 5s+ long cuts). Audio cross-correlation for sync. The EDL is editable before apply. (https://sportinger-masterselects.mintlify.app/ai/multicam-ai)
- **EdMon / Tellers / Montage AI** — pro "rough-cut" tools that assemble from transcript/brief and **export AAF/FCPXML/EDL/OTIO** back to NLEs. Tellers does semantic narration→B-roll matching ("aligned to what is being said, not timecode proximity"). Montage AI exports **OTIO/EDL**, does beat-sync, dialogue ducking, −14 LUFS normalize, 9 cutting-style pacing presets (dynamic/hitchcock/MTV/action…). (https://edmon.ai/, https://tellers.ai/use-cases/tv-post-production, https://mfahsold.github.io/montage-ai/)
- **premiere-agent** (kemerd) — local agent that preprocesses footage to text timelines, proposes a strategy, writes the cut, **self-evaluates every EDL boundary against source clips**, emits `cut.fcpxml`/`cut.xml`. Implements real **J-cuts (`audio_lead`), L-cuts (`video_tail`), cross-dissolves, native retime**, snaps cuts to whole frames (no A/V drift). A working reference for narration-aware split-edit EDL emission. (https://github.com/kemerd/premiere-agent)

Takeaway: **everyone serious separates a typed cut-plan (EDL) from the renderer.** The LLM/agent reasons over cheap metadata to produce the EDL; a deterministic engine renders it.

---

## TOOLS

| Name | URL | What | Headless? | Cost |
|------|-----|------|-----------|------|
| **OpenTimelineIO (OTIO)** | https://opentimelineio.readthedocs.io | API + interchange format = "a modern EDL". Clips, timing, tracks, transitions, markers, metadata; external media refs. Adapters to EDL/AAF/FCPXML/.otio. Python+C++. | Yes (pure lib, no render) | Free, Apache-2.0 |
| **Shotstack** | https://shotstack.io/solutions/video-as-code/ · https://shotstack.io/docs/api/ | Cloud JSON→video API. Timeline/tracks/clips/transitions/filters/titles; stateless render farm; templates + merge fields. | Yes (managed cloud, HTTP) | PAYG **$0.30/min**; Sub **$0.20/min** ($39/mo); 4K = enterprise. 10 free credits. (https://shotstack.io/pricing/) |
| **Remotion** | https://www.remotion.dev | React→MP4. Parameterized `inputProps`, `calculateMetadata()`. Render via `@remotion/renderer` (`renderMedia`) on own server, or `renderMediaOnLambda` (chunked parallel), or Vercel Sandbox / Cloud Run. | Yes (Node/Bun/Lambda/serverless) | OSS render lib free; **commercial automation licence $100/mo min, ~$0.01/render** + your compute. (https://www.remotion.dev) |
| **Revideo** | https://github.com/redotvideo/revideo · https://docs.re.video | OSS fork of Motion Canvas → library. TS video templates, deploy a render endpoint, React preview player. Parallelized + ffmpeg frame-extractor. Deploy to Cloud Run. | Yes (Node + headless Chromium) | Free OSS; you pay compute |
| **Editly** | https://github.com/mifi/editly | Declarative Node+ffmpeg NLE. JSON/JS spec of clips/images/audio/titles/transitions; streaming (low storage); Fabric.js + GL shader overlays. | Yes (Node + ffmpeg, ESM-only). Linux needs headless-gl. | Free, MIT. (⚠ low maintenance) |
| **Diffusion Studio core** | https://github.com/diffusionstudio/core · https://docs.diffusion.studio | Browser WebCodecs compositing engine (TS). **Declarative timeline**, layering, splitting, captions, **silence removal, transitions, keyframing, audio ramps, checkpoints**, HW-accel render. v3+ dropped ffmpeg (pure-TS muxers), supports long-form. Server-side via Playwright/Puppeteer. | Yes (browser; server via headless Chromium) | OSS v1 (MPL-2.0); v2+ commercial+non-commercial licence |
| **MoviePy** | (PyPI `moviepy`) | Python clip-composition lib over ffmpeg. The default in MPT/ShortGPT/MoneyPrinter. Imperative; not a contract. | Yes (Python + ffmpeg) | Free, MIT |
| **ffmpeg-concat** | https://github.com/transitive-bullshit/ffmpeg-concat | Concat clips with GL-transition support. Heavier on storage than Editly (Editly was built to beat it). | Yes | Free, MIT |
| **auto-editor** | https://github.com/wyattblue/auto-editor | CLI auto-cut by audio loudness / motion / silence; `--margin` pacing. **Native JSON timeline (`.v1/.v2/.v3`)** + exports premiere/resolve/fcp/shotcut/kdenlive XML. Effectively an EDL generator. | Yes (CLI + ffmpeg) | Free, Unlicense |
| **beatsync-engine** | https://github.com/Antiarin/beatsync-engine | Config-driven beat-synced editor (Python). librosa BPM (half/double clamp), **sub-bass 808 onset → snap cuts**, N-source weighted alternation, any aspect, ffmpeg render. Clean `audio→planner→sampler→renderer` module split = a real plan/render separation reference. | Yes (Python + ffmpeg, Dockerfile) | Free OSS |
| **librosa** | (PyPI `librosa`) | Beat / onset / tempo detection. The standard primitive for beat-synced cutting. | Yes (Python) | Free, ISC |
| **OpusClip API** | https://www.opus.pro/api | Cloud clip/reframe/caption/B-roll API + native MCP server + 6 SDKs + OpenAPI/llms.txt (agent-friendly). | Yes (HTTP) | Paid (usage) |

---

## IMPLEMENTATION (for our Mastra + Trigger + EDL)

### EDL: custom zod Timeline, OTIO as export-only

**Recommendation: build a custom typed `Timeline` schema in zod as the in-memory contract; treat OTIO as an optional export adapter, not the core type.**

Why not adopt OTIO as the primary type:
- OTIO is a Python/C++ library; our stack is TS (Mastra/Trigger/Convex). The Python binding would be an awkward dependency in a Trigger task.
- OTIO deliberately covers *only* editorial cut info (clips/timing/tracks/transitions/markers/metadata, external media refs — explicitly **not** embedded media). It has **no native slot** for our domain extras: caption styling, quote cards, chapter/intro/outro card templates, music-duck envelopes, reframe crop curves, per-account ChannelProfile bindings, self-heal annotations. You'd shove all of that into `metadata` blobs and lose type-safety — exactly the "9 undeclared keys" problem in a new costume.
- A **zod** `Timeline` gives compile-time + runtime validation, is trivially serializable to Convex/JSON, is directly readable by a Mastra tool, and lets the agent inspect/diff/critique a plan before render.

Keep OTIO available as a one-way **export adapter** (`timelineToOtio()`) only if/when you want NLE round-trip (DaVinci/Premiere) for manual finishing — a nice-to-have, not the spine. (auto-editor and Montage AI both prove EDL→NLE export is valuable but separable.)

Design the zod schema to be **OTIO-shaped** (tracks → clips with `mediaRef`, `source_in/out`, `timeline_start`, `transition`, `markers`) so an OTIO adapter is mechanical, plus first-class typed extensions: `captions[]`, `cards[]` (chapter/intro/outro w/ template id), `audioDuck` envelope, `reframe` crop spec, `profileId`.

### Renderer: keep ffmpeg, add a thin segment layer; consider Remotion only for motion-graphics cards

**Recommendation: keep ffmpeg as the render core — do NOT swap to Shotstack or rip out ffmpeg.**

- ffmpeg already works, is free, runs in a Trigger task, and you control it. Shotstack at $0.20-0.30/min is fine for low volume but becomes a recurring per-video tax at factory scale and adds an external dependency + upload round-trip; reserve it as a fallback, not the engine.
- The win is not a new renderer — it's making `renderTimeline` a **pure function of the EDL** with **per-segment idempotent caching**:
  - Render each timeline segment independently; key the output file on `hash(segment + profile + tool versions)`. Re-runs skip cached segments (content-addressed). This is exactly Remotion's "parametrize everything, same options per chunk = deterministic" guidance and beatsync-engine's extract→concat→mux split.
  - Final step = deterministic `concat` + `mux` of cached segments. A failed render resumes from the last good segment, not from zero.
- **Motion-graphics layers** (animated lower-thirds, chapter cards, quote cards, kinetic captions) are where raw ffmpeg is weakest. Two clean options: (a) pre-render each card to a transparent-bg WebM/MOV via **Remotion `renderMedia`** (React templates, parameterized by ChannelProfile) or **Revideo**, then ffmpeg-overlay it as a normal segment; or (b) Diffusion Studio core for browser-side compositing. Recommended: **Remotion for cards/overlays only** (per the project's existing Remotion-for-intros/outros split), ffmpeg for the spine. Cards become just another typed clip in the EDL whose `mediaRef` is a Remotion-rendered asset.

### Smart-cut inputs (feed planTimeline better signals)

- **Beat-sync**: run `librosa` (or shell out to beatsync-engine's approach) to produce a beat/onset grid; `planTimeline` snaps cut boundaries to beats per ChannelProfile pacing preset (cf. Masterselects "Music: cut on beat 1-2s", Montage AI's 9 pacing styles).
- **Narration-aware pacing + J/L cuts**: from the TTS/transcript word timings, set chapter/segment boundaries on sentence ends, hold B-roll over narration, and emit `audioLead`/`videoTail` offsets for J/L audio cuts (cf. premiere-agent). This is the single biggest "broadcast-grade" upgrade over a naive flat concat.
- **Silence/dead-air trim**: `auto-editor` (or its loudness method) as a pre-pass on any spoken segments.
- **Dynamic reframe**: subject detection (face/saliency) → crop curve in the EDL for vertical variants; **reframe before captions** (OpusClip's documented gotcha).
- **Audio**: dialogue duck envelope + −14 LUFS normalize in the EDL (Montage AI / broadcast standard), not an ad-hoc `amix` constant.

### Idempotent + resumable as a Trigger task

- `planTimeline` (Mastra tool, cheap) writes the `Timeline` to Convex → returns it for agent inspection/approval.
- `renderTimeline` (Trigger.dev durable task) takes the `Timeline` id, renders segments with content-addressed cache (store rendered segment hashes + URLs in Convex/R2). Trigger checkpoints between segments; on retry it re-reads which segment hashes already exist in R2 and skips them. Final concat/mux only when all segments present. The task is then naturally **idempotent** (same Timeline → same output) and **resumable** (partial failure resumes from last cached segment).

---

## TOP 3 MOVES

1. **Make the EDL the contract.** Define a custom **zod `Timeline`** (OTIO-shaped, with typed `captions/cards/audioDuck/reframe/profileId` extensions). Split the 269-LOC god-block into pure **`planTimeline`** (Mastra tool, cheap, inspectable, reads ChannelProfile not 9 hidden keys) and pure **`renderTimeline`** (Trigger durable task). OTIO export is an optional adapter, not the core type.
2. **Keep ffmpeg, make render idempotent + resumable.** Render per-segment, content-address each output on `hash(segment+profile+versions)`, cache in R2, skip cached on retry, deterministic final concat/mux. Add **Remotion** *only* for motion-graphics cards/overlays (rendered to transparent assets that become normal EDL clips) — don't adopt Shotstack as the engine (keep as fallback).
3. **Feed `planTimeline` real edit signals** so the plan is broadcast-grade, not flat concat: **librosa beat grid** (beat-snapped cuts), **transcript word-timings** for narration-aware pacing + **J/L cuts** (audioLead/videoTail), **auto-editor** silence trim, **subject-detection reframe-before-captions**, and a typed **dialogue-duck + −14 LUFS** audio envelope in the EDL.
