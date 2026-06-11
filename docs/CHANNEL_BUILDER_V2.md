
## GOLDEN REFERENCE — v1 lofi/loop engine (`seamless_loops`)

From v1 `passive-income/lofi-generator` (background_manager.py → AnimeBackgroundManager,
scene_director.py, video_builder.py). Replicate for music_loop / sleep / pixel / any
music-led channel.

1. STILL: Flux from a per-niche VARIED prompt (`_vary_prompt`, no two alike) → Gemini
   Vision validates per-niche mandatory_elements (pass ~60-70%, else regen).
2. SCENE DIRECTOR ("find moving things"): Gemini Vision → spatial motion prompt (which
   elements animate + zones, e.g. "cat breathing, tail flick; steam from mug; rain on
   glass"). Second Gemini pre-validation gate fixes spatial errors before paying. Indoor
   niches add an anti-rain suffix.
3. CLIP A (15s): Kling v3 Omni `kwaivgi/kling-v3-omni-video` (Replicate), mode:pro,
   start_image=still, duration:15, 16:9, no audio. Full motion.
4. SEAMLESS RETURN — CLIP B (15s): extract A's first frame (`ffmpeg -i`) + last frame
   (`ffmpeg -sseof -0.1`), upload both to Replicate files. Kling start_image=LAST frame,
   end_image=FIRST frame, prompt = motion + "gently settling back to original resting
   position, very smooth". → animates back to start.
5. 30s UNIT: re-encode A+B (libx264 crf18, 24fps), concat → unit whose LAST frame == FIRST
   frame. stream_loop repeats it invisibly for hours.
6. (opt) Topaz 4K upscale of the unit (v2 `upscaleLoopUnit`).
7. INTRO+DEBLUR (no separate card): stream-loop the unit under the FULL music; over first
   ~8s overlay channel name + title with 20-step progressive deblur (gblur sigma 20→1,
   0.4s/step) + 2s fade. Animation plays from frame 1.

KEY: Kling v3 Omni `end_image` is what makes the loop seamless. v2 build: src/lib/kling.ts
(animate start+end via replicate.ts) + reuse generateFalFluxProImage + gemini director +
ffmpeg extract/concat + upscaleLoopUnit + new ffmpeg deblur-mux. Wire as music_loop visuals.

NOTE: loop engine uses the Higgsfield CLI (src/lib/higgsfield.ts: generateKeyframe flux_2 + generateClip kling3_0 with --start-image/--end-image), NOT Replicate Kling. Same Kling model, via your Higgs CLI. Requires HIGGSFIELD_LIVE=1 + an authed higgsfield session in the runtime.

## CHANNEL BUILDER V2 — feature wiring (2026-06-05)

Five operator-control features, all flowing wizard → /api/build-channel → design-channel → designPipeline → block params:

1. LOCALIZATION (ES/DE). Wizard `locale` → designer sets `script_gen.language`, `narration_tts.language`, `metadata.language`. scriptGen `langDirective()` makes Gemini write spoken narration in-language (names/quotes kept); metadata block writes localized title/description/tags/keywords/hashtags. Default en = no-op.
2. VOICE-FX "old radio". Wizard `voiceFx` (narrated only) → `narration_tts.voiceFx`. ffmpeg `applyVoiceFx()` (src/lib/ffmpeg.ts) applies a vintage AM chain (highpass 350 / lowpass 3000 + acompressor + alimiter + tremolo + low brown-noise static bed) to the finished narration before upload. Unknown/none = passthrough.
3. SERIES GENERATOR. Wizard `seriesTitle` + `seriesCount` → `topic_select.seriesTitle/seriesCount`. topic_select series branch: episode N = (# existing series entries)+1, Gemini writes a continuing subtitle, clean title `"<series> — Part N of M: <subtitle>"`. After M episodes it falls through to normal topic generation. Open-ended when count=0.
4. AUTO-SEO ON CREATE. design-channel step 5: `refreshNicheResearchCore()` (competitors + power words + title patterns) then `optimizeTopics({count:24})` → merged into `identity.topicPool` in a single identity write (with art). Best-effort, never blocks creation.
5. ADVANCED PER-MODULE EDITOR. src/engine/moduleCatalog.ts = MODULE_CATALOG manifest (block → editable ParamField[], type/bounds/options, optional flag) + `sanitizeParamOverrides()`. Wizard Review step renders controls for every module in the designed pipeline → `paramOverrides[block][key]`; route sanitizes (drops unknown keys, clamps numbers); designer merges overrides on top of derived params (overrides win).
