# 04 — LAYER + DATA-VIZ INSERTS (Research, June 2026)

Two pipeline steps of the YouTube factory:
- **(A) LAYER** — word-level captions + quote overlays + intro/title cards.
- **(B) DATA-VIZ INSERTS** — script-synced stats/charts.

Scope: how leaders do it, the tool landscape, and how to push our Remotion + Mastra + EDL stack to next-level.

---

## NOW

**LAYER (current):** word-timed captions, quote overlays, intro card composited in Remotion, styled by channel-DNA typography (`QuoteOverlay` / `TitleCard` comps + caption burn-in).

**INSERTS (current):** script-synced data-viz (big stats, line/bar charts) rendered in Remotion, timed to narration, with a **verbatim-number integrity gate** (only visualizes numbers the narration actually speaks). `DataInsert` comp + `insertBlocks.ts` (~13K).

Both driven (planned) by clean per-account Mastra tools reading a `ChannelProfile` + a **Timeline/EDL** where overlays are entries with `[start,end]` windows.

---

## AFTER

**LAYER → NEXT:**
- Active-word **karaoke** captions (current spoken word highlighted) with **emphasis** styling on keywords, derived from WhisperX word timings already in the EDL.
- Auto **keyword + emoji** highlight pass: LLM tags high-salience tokens per page; emoji placed contextually (Submagic hits ~78% contextual placement, drives 2.3x completion in A/B). Toggleable per channel DNA.
- Branded, **templated** caption/overlay styles selected by `ChannelProfile` (font, stroke, color, animation preset, emoji on/off, keyword-highlight rules) — the "Brand Kit" pattern every leader now ships.
- Premium motion for intro/title/lower-thirds via **Lottie** (After Effects → JSON) or **Rive** (data-bound, parametrizable) rendered inside Remotion.

**INSERTS → NEXT:**
- LLM **auto-selects WHICH numbers/claims deserve a viz** (insight-detection), not just "any number spoken" — pick top-N by salience/surprise, choose chart type, keep the verbatim-number gate as a hard provenance check.
- Charts as **declarative EDL/DVSpec entries** bound to data fields + **narration-index triggers** (not absolute timestamps) so re-timed TTS auto-realigns animation.
- All overlays (captions, quotes, stats, charts, lower-thirds) become uniform **EDL entries** with `[start,end]`, `type`, `style`, `dataRef`.

---

## HOW LEADERS DO IT

**Captions / overlays (short-form leaders):**
- **Submagic** — auto captions (98%+, 50+ langs) + word-by-word highlight/bounce/fade (35+ animation templates), auto-emoji placement (~78% contextual), auto **B-roll** insertion (reads transcript, slider controls frequency), Brand Kit per-brand enforcement. Strongest animated-caption category. (submagic.co/features/auto-video-editor)
- **Captions.ai** — AI Edit with style presets, scene cutting, **AI B-roll generator** (prompt or transcript-driven), chat-based prompt editing. (captions.ai/tools/ai-b-roll-generator)
- **Opus Clip** — AI keyword highlighter **tracks the currently spoken word** on-screen + auto-highlights important keywords (two color slots: tracker + keyword); AI Emojis from caption context; Brand Template (custom fonts, intro/outro, overlays). (help.opus.pro / opus.pro/captions)
- **CapCut / Veed / Kapwing** — auto-captions + template styles; CapCut free/basic with manual editing; all converging on word-highlight + emoji + template presets.

Pattern: transcribe → page into caption groups → highlight active word → LLM tags keywords/emoji → apply branded template. Nobody hand-times.

**Auto data-viz (the academic + product frontier):**
- **Moshion** (moshion.app) — paste a script, it "surfaces every moment worth animating: maps, charts, timelines, stat callouts," you select, it generates MP4/MOV (incl. transparent ProRes 4444 overlays). NL refine ("zoom into Europe"). This is *exactly* the insert step productized.
- **HeyGen Infographic Video Maker** — PDF/script/URL → scene-by-scene animated infographic + narration.
- **DataMagic** (arXiv 2606.20388, VLDB 2026) — **most architecturally relevant.** Raw data + NL query → **DVSpec** declarative spec → Remotion render. Two mechanisms we should copy: (1) **data-driven semantic references** (visual elements reference data *attribute values* `{"company":"Nvidia"}`, not hard IDs → full provenance, fuzzy-matched at render), (2) **narration-index declarative triggering** (animations triggered by narration-segment index, auto-aligned to TTS audio duration at render — edit narration, sync survives, no keyframe fixups). Multi-agent **Generate-then-Orchestrate** (Story Planner → Data Manager → Visual Designer candidate scenes in parallel → Narration Director + Animation Coordinator global pass). Direct one-pass LLM gen scored 1.9–2.2/5 w/ 48–86% exec rate; DVSpec lifted to 3.89/5, >95% exec. **Renders charts with D3 + video with Remotion** — our exact stack.
- **Data Playwright / Data Player** (Shen et al., CHI/TVCG 2024–25) — annotated-narration syntax; LLM extracts target visual elements, animation effects, properties per narration segment; TTS assigns per-word timestamps as the timeline.
- **ChartifyText** (arXiv 2410.14331) — infers a table schema + cell values from data-involved *text*, then augmented charts (ranges/uncertainty/sentiment). Good model for "text → chartable data."
- **Infogen / AgentAda** — insight-selection: generate candidate questions, **rank** which sub-charts/insights are worth showing, coder+feedback agents emit chart code with self-correction (≤3 retries).

Insight: leaders converge on a **declarative spec decoupled from render**, bound to data by **semantic reference**, triggered by **narration index** — then an **agent ranks which insights deserve a viz**.

---

## TOOLS

| Layer | Tool | Use | Headless? | URL |
|---|---|---|---|---|
| Transcribe/word-time | **WhisperX** (large-v3 + wav2vec2 CTC) | best OSS word/char timestamps; `interpolate_nans` fallback to ASR ts; **degrades on non-Western langs (KO/JA)** | Yes (GPU) | github.com/m-bain/whisperX |
| Transcribe (commercial) | **AssemblyAI** Universal-3 | word ts + speaker; **lowest hallucination** (best for high-stakes verbatim gate) | API | assemblyai.com |
| Transcribe (realtime) | **Deepgram** Nova-3 | streaming-first, ~450ms; not needed for batch factory | API | deepgram.com |
| Forced align (multiling.) | **Meta Seamless** | best aligner on 6/9 langs (dur-prediction) if we go multilingual | Yes | — |
| Caption type→Caption | **@remotion/captions** | `createTikTokStyleCaptions({captions, combineTokensWithinMilliseconds})` → pages w/ per-token `fromMs/toMs` for word-by-word; converters from whisper-cpp/openai-whisper/elevenlabs | Yes | remotion.dev/docs/captions |
| Caption fit/scale | **@remotion/layout-utils** `fitText()` | auto-scale text to video width | Yes | remotion.dev/docs/captions/displaying |
| Charts-as-video | **Remotion** (`useCurrentFrame`, `interpolate`, `spring`) | **drive ALL motion from `useCurrentFrame`** — 3rd-party chart animations flicker. Use D3/Recharts for *layout/static* only, animate yourself | Yes (Chromium+FFmpeg) | remotion.dev/docs/animating-properties |
| Line/stock paths | **@remotion/paths** `evolvePath` | strokeDasharray/offset draw-on for line charts | Yes | remotion-dev/skills charts.md |
| Chart math/scales | **D3** (scales, arcs, projections) | compute coords only, no D3 transitions | Yes | — |
| Vega-Lite specs | **Vega-Lite** | "From Data to Story" base charts + annotations; declarative | Yes | — |
| Premium motion (AE) | **@remotion/lottie** | AE→JSON; `delayRender`/`continueRender` gate on load; data binding rolling out (dotLottie) | Yes | remotion.dev/docs/lottie |
| Premium motion (data-bound) | **@remotion/rive** | Rive state machines + **data binding** (bind numbers/booleans→animation); design in Rive, parametrize in Remotion | Yes (`.advance()`) | remotion.dev/docs/rive |
| Productized insert gen | **Moshion** | script→animated chart/map/timeline MP4 (ProRes transparent overlay export) | API/MP4 | moshion.app |
| Math/explainer motion | **Manim** | code-driven math animation (alt to Remotion for equations) | Yes (Python) | — |

---

## IMPLEMENTATION (Remotion + Mastra + EDL)

1. **EDL = our DVSpec.** Make every overlay (caption page, quote, title card, stat, chart, lower-third) a typed EDL entry:
   `{ type, startMs|narrationIndex, endMs, style:ChannelProfileRef, dataRef?, payload }`.
   Adopt DataMagic's **narration-index triggering**: store `narrationIndex` (segment) + offset, resolve to ms at render from WhisperX/TTS word timings. Edit narration → realign free.

2. **Captions.** WhisperX (already producing word timings) → `@remotion/captions` `Caption[]` → `createTikTokStyleCaptions` for pages. Render with active-word highlight: per frame, `currentMs ∈ [token.fromMs, token.toMs]` → emphasis style. `fitText()` for auto-scale. Animation preset + emoji rules come from `ChannelProfile`.

3. **Keyword/emoji pass (Mastra tool).** Per caption page, LLM tags salient tokens + optional emoji; output is style flags on EDL caption entry (toggle per channel). Keep deterministic fallback (no-highlight) if model unsure.

4. **Insert insight-selection (Mastra tool, Generate-then-Orchestrate).**
   - *Generate:* from script, extract candidate claims/numbers + propose chart type + dataRef (ChartifyText-style text→table inference).
   - *Rank:* score by salience/surprise/coverage (Infogen/AgentAda ranker), pick top-N. **Hard gate: verbatim-number integrity** — drop any viz whose number isn't spoken (keep current gate as the final provenance check).
   - *Orchestrate:* bind data entities mentioned in narration → chart elements via **semantic reference**; emit EDL chart entries with narration-index triggers.

5. **Chart render.** `DataInsert`/chart comps drive bars via staggered `spring({delay:i*STAGGER})`, pie via `stroke-dashoffset`, lines via `@remotion/paths evolvePath` — **all from `useCurrentFrame`** (never lib animations → flicker). D3 only for scales/paths.

6. **Premium tier.** Branded intro/title/lower-thirds → Lottie (AE assets) or Rive (data-bound numbers) per channel DNA. Optionally call **Moshion** for maps/timelines we don't want to hand-build, import the transparent ProRes as an EDL b-roll/overlay entry.

7. **Per-channel DNA.** `ChannelProfile` carries: caption template + animation preset, keyword/emoji rules, chart palette/theme, motion engine (native/Lottie/Rive), insert density. Mastra tools read it; EDL entries reference it — one switch restyles everything.

---

## TOP 3 MOVES

1. **Promote the EDL to a DataMagic-style DVSpec**: typed entries for all overlays, **semantic data references** + **narration-index triggers** so chart sync auto-survives TTS/narration edits. Highest leverage — fixes the #1 failure (audio-visual misalignment) the literature documents.
2. **Add the insight-selection agent** (Generate→Rank→Orchestrate) so inserts visualize the *right* numbers, not every number — behind the existing verbatim-number gate. Use AssemblyAI/WhisperX word ts as the timeline source of truth.
3. **Ship branded caption + emoji/keyword layer** driven by `ChannelProfile`: `@remotion/captions` TikTok pages + active-word highlight + LLM keyword/emoji tagging + per-channel template. Matches Submagic/Opus parity, biggest watch-time lever (2.3x completion in A/B tests).

---

### Sources
- submagic.co/features/auto-video-editor · submagic.co/ai-caption · triedbyhumans.com/tools/submagic/review
- captions.ai/tools/ai-b-roll-generator · help.opus.pro (AI emojis/keywords) · opus.pro/captions
- moshion.app · heygen.com/tool/infographic-video-maker
- arXiv 2606.20388 (DataMagic/DVSpec) · arXiv 2408.03876 (From Data to Story) · arXiv 2410.03093 (Data Playwright) · arXiv 2410.14331 (ChartifyText) · arXiv 2507.20046 (Infogen) · arXiv 2504.07421 (AgentAda)
- remotion.dev/docs/captions · /docs/captions/displaying · /docs/captions/create-tiktok-style-captions · /docs/animating-properties · /docs/lottie · /docs/rive · github.com/remotion-dev/skills charts.md
- WhisperX: deepwiki.com/m-bain/whisperX · benchmarks: scribie (N-WER WhisperX 12.81% < AssemblyAI 15.13% < Deepgram 15.62%) · iyakovlev.dev forced-alignment benchmark (Seamless best multiling.)
