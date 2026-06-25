# Module Level-Up Deck — NOW → AFTER (short form)

Per-step internet research (June 2026). Full detail per module in `01_assembly.md` … `06_architect.md`.
Bar = "level-up THEN golden". Spine: intel→brief→write→guard→voice→visual→layer→build→package→verify→ship.

| # | Module | NOW (today) | AFTER (next-level) | #1 move |
|---|--------|-------------|--------------------|---------|
| 01 ⭐ | **Assembly** | 269-LOC god-block fuses plan+render over raw ffmpeg, 9 hidden store keys; cuts are length-driven → "templated" look | Pure `planTimeline → typed EDL → idempotent renderTimeline`. Beat- & narration-synced cuts, J/L audio cuts, −14 LUFS duck, vertical reframe, motion-graphic cards. Per-account; Mastra tool + Trigger render | zod `Timeline` schema + split god-block, parity-prove |
| 02 | **Visuals** | LLM keyword query → 4K stock → watermark/relevance gate → dedup (keyword search = "AI-slop montage") | Semantic clip↔beat ranking (embed line+footage, cosine), shot-grammar coverage contract, adjacency dedup, stock→generated fallback ladder | Semantic re-rank before the gate (~free, biggest lift) |
| 03 | **Crew** | 5 hardcoded role-blocks; Showrunner→creativeBrief; fail-loud | One generic Director tool reads a per-channel `crewProfile` (data) via Mastra runtimeContext — zero N code paths; market-aware critic | Move crew → `crewProfile` on ChannelProfile |
| 04 | **Guard** | qa_script + originality (flat cosine @0.92) + single-pass compliance | Typed fail-fast gates `{pass,score,violations,selfHealHint}` → bounded self-heal; 2-stage dedup (MinHash-LSH→embedding ANN); GARM+YouTube rubric judge | Typed gate contract + 2-stage dedup |
| 05 | **Layer + Inserts** | word-timed captions + quote/title comps; data-viz gated to spoken numbers | Active-word **karaoke** captions + keyword/emoji highlight + branded per-profile templates; **insight-selection agent** picks which numbers get a chart; overlays = EDL entries w/ narration-index triggers | Branded karaoke caption layer + overlays-as-EDL |
| 06 | **Verify + Ship** | vision-only QA (thumb@168px); resumable PRIVATE upload + Ayrshare; **double-upload risk** | Verify = 3-layer (ffmpeg metrics → vision rubric, conf<0.75→human → competitor click-pred); Ship = **idempotent** + per-platform fan-out + Test&Compare A/B + analytics feedback | Ship idempotency (Trigger key + persist youtubeId) — safety-critical |
| 07 | **Pipeline Architect** | family → 1 of 5 hardcoded archetypes, LLM edits a seeded list; no market signal | Reads a **NicheBrief** (market signals) + the **module capability registry** → composes a validated module DAG de-novo → freezes a `ChannelProfile` → deterministic Director executes | `buildCapabilityRegistry()` + a `marketIntel→NicheBrief` tool |

## Key tools by module (named, with links in the per-module docs)
- **Assembly:** custom zod Timeline (OTIO-shaped, OTIO export-only) · keep ffmpeg · Remotion (cards only) · librosa (beat grid) · auto-editor (silence trim) · Netflix VMAF
- **Visuals:** Pexels API · OpenAI text-embedding-3-small / Voyage multimodal · Convex vector search (reuse infra) · PySceneDetect · Veo/Higgsfield fallback
- **Crew/Guard:** Mastra dynamic agents/runtimeContext · CrewAI yaml profiles · Datasketch MinHash-LSH · Hive brand-safety · LLM-as-judge + calibration
- **Layer/Inserts:** WhisperX word-timing · @remotion/captions · @remotion/rive · DataMagic "DVSpec" pattern (proven on our exact D3→Remotion stack)
- **Verify/Ship:** ffmpeg blackdetect/freezedetect/ebur128 · Trigger idempotency · YouTube Data API resumable · Blotato/upload-post
- **Architect:** planner-executor/LLMCompiler · enum-constrained planner + static DAG validator · Tool-RAG · Mastra supervisor + requireApproval · vidIQ MCP + OutlierKit (market intel)

## Build order (what unlocks what)
1. **ChannelProfile skeleton** ✅ done — the per-account spine every module reads.
2. **Assembly EDL split** (item 1, in progress) — proves the plan/render + tool-contract pattern.
3. **Each module → typed Mastra tool + capability card**, leveled per the table → bank golden as each lands.
4. **Capability Registry** — the catalog of leveled-up tools (the Architect's menu).
5. **Pipeline Architect** — needs the registry + ChannelProfile + tools to exist first.
6. **Crew Profiles + Ads** — last.

**The thread:** every module you level up = a self-describing tool in the catalog. Once the catalog exists, the Architect can auto-compose. **Golden-first IS the on-ramp to the Architect.**
