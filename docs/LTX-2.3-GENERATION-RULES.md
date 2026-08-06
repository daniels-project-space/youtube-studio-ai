# LTX-2.3 Generation Rules — canonical ruleset for all AI-video generation

**Scope:** every LTX-2.3 render in this project (the Salad `salad-ltx` engine + any workflow that
calls `renderGpuVideo`). Derived from Lightricks' official docs/README, the LTX-2.3 prompt guide,
the ComfyUI-LTXVideo repo, and field-tested community reports (Apatero 500-video writeup, ltxworkflow.com,
r/StableDiffusion triple-stage threads). Last synthesised 2026-07-05.

LTX-2.3 is a **22B joint audio-video** DiT — it generates **video + synchronized audio in one pass**.
Audio is therefore a **first-class control**, not an afterthought.

---

## 1. Prompt structure (HARD RULE)

One **flowing paragraph, ≤200 words**, chronological, **action-first**, literal + precise — write like a
cinematographer dictating a shot. Build in this order:

1. **Main action** — one sentence, start directly with it (no "A video of…").
2. **Movements & gestures** — specific, physical.
3. **Character/object appearance** — precise (clothing, age, materials).
4. **Background & environment** — setting, props, depth.
5. **Camera** — angle + movement in clean language: `slow dolly in`, `handheld tracking`, `over-the-shoulder`, `static locked-off`.
6. **Lighting & colour** — `backlight`, `soft rim light`, `golden hour`, `flickering lamp`, named palette.
7. **Changes / sudden events** — what shifts during the clip.
8. **Audio** — woven **throughout** (see §2), never appended at the end.

Name a **style early** if wanted (`film noir`, `analog 16mm`, `painterly`, `fashion editorial`).

### Do
- Cinematic shot language + shallow DoF + natural motion (LTX's sweet spot).
- Single, clear subject with emotive expression.
- Atmosphere anchors: fog, mist, golden hour, rain, reflections, ambient texture.
- **Show don't tell** emotion → posture, gesture, facial cues (NOT the word "sad").
- Start simple, **layer complexity across iterations**.

### Don't
- ❌ Emotional labels without visual cues ("confused", "nervous").
- ❌ Readable **text / logos / signage / brand names** — LTX cannot render legible text.
- ❌ Chaotic/non-linear physics (jumping, juggling, fast twisting) → artifacts. (Dancing is fine.)
- ❌ Scene overload — too many characters/actions/objects drops adherence.
- ❌ Conflicting light sources ("warm sunset + cold fluorescent") unless clearly motivated.
- ❌ Over-stuffed prompts — every extra instruction risks being dropped.

---

## 2. Audio prompting (native AV — first-class)

Describe **what you hear**, integrated chronologically with the visuals. Build in **layers**:

1. **Ambient bed** (most reliable) — `wind in trees`, `room tone`, `distant traffic`, `low rumble in a narrow alley`.
2. **Contextual foley** — scene-timed accents the visuals imply: `a single cabinet closes`, `footsteps on gravel`, `engine whoosh as it crosses frame`.
3. **Music texture** — genre/instrumentation/tempo/mood, kept quiet: `soft ambient synth drone`. (Not a full score.)
4. **Speech** — dialogue in **"quotes"** + language + accent + vocal characteristic: `in a low raspy whisper, "we're late—move!"`.

### Audio rules
- **Specific > vague**: "soft footsteps on tile" beats "ambient sound".
- **Relative timing, never in-text timestamps**: "a cabinet closes once", NOT "at 00:03 a cabinet closes".
- **No sound shopping-lists** → priority confusion → audio mush. A few well-chosen layers only.
- Align **audio intensity with action tempo**; rhythm words ("on the downbeat", "at regular intervals") help sync.
- **modality_scale > 1.0 (≈3.0)** when generating audio; 1.0 for video-only.
- **Reality check (do in post):** intelligible **dialogue is not reliable yet** (mouth-shaped noise). Treat LTX audio as a
  **smart foley/ambience bed**; overdub hero VO / music / key SFX manually. Our pipeline: LTX draws the ambience, Clyde/real VO on top.
- Audio latent length **must be ≥ video length** or sync breaks / unrelated audio appears.

---

## 3. Parameters — highest-quality reference

| Control | Distilled (fast, our default) | Dev (max fidelity) |
|---|---|---|
| Steps | **8** (stage-1) + 3–4 (stage-2 refine) | 20–50 (15–40) |
| CFG | **1** (do NOT raise — doubles VRAM, no gain) | 3–5 (≈4) |
| Sampler | `euler_ancestral_cfg_pp` | LTXV Scheduler + multimodal guider |
| Distilled LoRA | v1.1 @ **0.5** | v1.1 @ 0.2 |
| Scheduler sigmas | LTX2Scheduler-generated (NEVER hardcoded Karras → grid/bio-cell artifact) | LTXV Scheduler |

**Guidance (MultiModalGuider):** `cfg_scale` 2–5 (4) · `stg_scale` 0.5–1.5 (1.0), `stg_blocks [29]` · `rescale` 0.5–0.7 · `modality_scale` 3.0 (AV) · `skip_step` to speed.

**Geometry (HARD constraints):**
- Width & height **divisible by 32** → use **1280×704** (not 720), **1920×1088** (not 1080), **768×512** base.
- Frames **8n+1**: 65, 97, **121**, 161 (official range 65–257). `duration = frames / fps`.
- FPS: **24** cinematic / 25 default / 30 smoother — keep identical between `LTXVConditioning` and `CreateVideo`.

**i2v conditioning:**
- Stage-1 image-inject strength **0.7** (leaves room for motion); Stage-2 re-inject **1.0** (preserves detail).
- **`LTXVPreprocess` degrades the input still** (video-compression look) on purpose — a too-clean image → a video that won't move. Keep it.
- Want the first frame to match the still exactly → conditioning 1.0; want it to blend → lower it.

**Negative prompt (default):**
`worst quality, low quality, blurry, distorted, morphing, flickering, inconsistent, jittery motion, watermark, text, logo, cartoonish, deformed`

Always set a **seed** for reproducibility.

---

## 4. Efficiency & quality workflow

- **Generate low, upscale up.** 480–720p base → LTX **×2 spatial upscaler (always v1.1** — v1.0 corrupts last frames) → (optional) Topaz/4K. Beats native-4K generation on coherence AND VRAM.
- **Draft-then-commit:** batch ~10 variations at 480p → pick composition → re-gen at 720p → upscale.
- **Three-stage > two-stage** (community, better *and* faster): S1 half-res 30 steps (structure) → S2 upsample 6 steps → S3 6-step cleanup; total ~42 steps but most are cheap half-res. Locks background/audio, kills the two-stage "broken background" bug. Must use LTX2Scheduler sigmas.
- **Motion fixes:** static/zoom-out clip → add explicit `dolly out` / camera move OR a **camera LoRA @ 0.5**. Motion blur → raise fps, shorten the move, add "sharp clear motion". Flicker → shorter clip, lower CFG, "smooth stable consistent".
- **On a 32GB 5090:** you can't do long-AND-4K in one pass. Render base ≤~5–8s @ ≤768–1088p, then upscale for resolution and chain clips for length. Use tiled VAE decode, `--reserve-vram 5`, low_vram_loaders.

---

## 5. Integrations & control add-ons

- **ComfyUI-LTXVideo** (Lightricks) — nodes + official 2.3 workflows (`Single_Stage_Distilled_Full`, `Two_Stage_Distilled`, IC-LoRA set).
- **Camera-Control LoRAs** — dolly in/out/left/right, jib up/down, static. Load via `LTXVQ8LoraModelLoader`, strength **0.8–1.0** (drop to **0.5** to avoid artifacts). *(Still LTX-2 era; no native 2.3 camera LoRA yet.)*
- **IC-LoRAs** (In-Context, reference-driven) via `LTXICLoRALoaderModelOnly` (ref-downscale 0.5) **+ distilled LoRA @ 0.5**:
  - **Union Control** (depth+canny+pose in one) · **Motion Track** (draw paths: `LTX Draw Tracks` / `Sparse Track Editor`) · **Detailer** (texture) · **HDR** (linear EXR; set `OPENCV_IO_ENABLE_OPENEXR=1`) · **Lipdub** · **Inpaint/Outpaint** · **Pixel Spatial Upscaler** (generative 4×).
  - ⚠️ Camera LoRA and IC-LoRA **cannot be combined** in one generation.
- **Upscalers:** LTX spatial **x2-1.1** (latent) + temporal x2 (doubles fps) in-pipeline (free, GPU); **Topaz Video cloud API** (Proteus / Starlight, X-API-Key) for optional final 4K polish — *their* GPUs, needs a Topaz key + credits.
- ⚠️ **LTX-2 (non-IC) LoRAs must be retrained for the 2.3 latent space.** Camera LoRAs excepted (use at 0.5).

---

## 6. Project rules (the short version)

1. Prompt = one ≤200-word cinematographer paragraph in the §1 order; audio woven in per §2.
2. Never ask LTX for on-screen text/logos or chaotic physics; show emotion physically.
3. Treat generated audio as an **ambience bed** — overdub hero VO/music/SFX in post.
4. Dims ÷32, frames 8n+1, fps consistent; distilled = 8 steps / CFG 1 / LoRA 0.5.
5. Render low → **v1.1** spatial upscale → optional Topaz; never native-4K in one pass on the 5090.
6. Always seed; always use the default negative prompt; keep `modality_scale ≈ 3` for AV.
7. Add motion explicitly (camera verb or camera-LoRA @0.5) — LTX i2v drifts static otherwise.
