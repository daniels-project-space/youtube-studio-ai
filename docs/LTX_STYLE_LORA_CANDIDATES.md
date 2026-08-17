# LTX style LoRA candidates (research list — not machine-consumed)

This is a human-readable research/candidate list for community and official
LTX creative-style LoRAs, gathered to back the per-style `candidateAdapterIds`
fields in the `src/engine/ltxStylePresets.ts` style registry (built in a
parallel task). This file is deliberately plain markdown, not TypeScript or
JSON, so it can never be accidentally parsed as live configuration by
`src/lib/ltxCreativeAdapter.ts`'s resolver.

Every candidate id string here is a *research pointer*, not a configuration
value. As `docs/LTX_2_5_RTX_4090_OPERATIONAL_CONTRACT.md` and
`ltxCreativeAdapter.ts` establish, community LoRA activation is gated behind
a SHA-pinned worker manifest entry that has passed a controlled, paid Novita
RTX-4090 visual benchmark. Nothing described below is registered today, and
nothing in this document changes that.

---

## Style: anime

No community or official LoRA that *produces* an anime look for LTX-2.5 was
found in this research pass. The closest adjacent asset is the Alisson
Pereira anime-to-photorealistic IC-LoRA (see the **photorealistic** section
below) — but that LoRA pushes video in the *opposite* direction (anime source
frames toward photorealism), so it is not a fit for generating an anime
style itself. Style differentiation for `anime` should rely on prompt
guidance only until a dedicated anime-targeting LoRA surfaces.

Not registered in the worker manifest. Activation requires Daniel to run the paid Novita benchmark per `docs/LTX_2_5_RTX_4090_OPERATIONAL_CONTRACT.md` — do not add to `ltxCreativeAdapter.ts`'s manifest until that passes.

---

## Style: photorealistic

### 1. Anime2Real IC-LoRA (Alisson Pereira / Alissonerdx)
- **Source:** ComfyUI workflow page — https://comfy.org/workflows/6fec31e40f4a-6fec31e40f4a/ (workflow author's Hugging Face profile: https://huggingface.co/Alissonerdx). A direct Hugging Face model-card URL for this specific IC-LoRA file was not locatable in this pass — the workflow page names the model as "trained by Alisson Pereira" but does not link a standalone model repo; `Alissonerdx/LTX-LoRAs` on Hugging Face hosts this creator's other LTX-2.3 LoRAs (inpainting, edit-anything) but its file listing does not include this exact anime2real weight, so treat the link as best-effort until re-verified.
- **What it does:** A ComfyUI workflow that extracts frames from anime source video (via Video Helper Suite nodes), runs each frame through an LTX 2.3 IC-LoRA image-to-image pass trained by Alisson Pereira to push it toward photorealism, then recombines the frames into output video.
- **Why it fits:** Directly targets the anime-to-photorealistic transformation direction, i.e. exactly the `photorealistic` style's core visual goal when the source material or a prior pass is stylized/anime-leaning.

Not registered in the worker manifest. Activation requires Daniel to run the paid Novita benchmark per `docs/LTX_2_5_RTX_4090_OPERATIONAL_CONTRACT.md` — do not add to `ltxCreativeAdapter.ts`'s manifest until that passes.

### 2. Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control (official)
- **Source:** https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control
- **What it does:** Lightricks' own unified control IC-LoRA trained on LTX-2.3-22b, combining multiple structural control signals (canny/depth/pose-style conditioning) from a reference video into one adapter.
- **Why it fits:** Structure-preserving control keeps photorealistic renders geometrically coherent with a reference take, which is useful when the `photorealistic` style needs to lock camera/subject structure while text prompts carry the visual realism.

Not registered in the worker manifest. Activation requires Daniel to run the paid Novita benchmark per `docs/LTX_2_5_RTX_4090_OPERATIONAL_CONTRACT.md` — do not add to `ltxCreativeAdapter.ts`'s manifest until that passes.

---

## Style: watercolor

No dedicated community LoRA for a watercolor look was found as of this
research pass. The only tangential mention is that Alissonerdx's general
"Edit Anything" LTX-2.3 LoRA (`ltx23_edit_anything_global_rank128_v1_9000steps_adamw.safetensors`,
part of https://huggingface.co/Alissonerdx/LTX-LoRAs) lists "watercolor" as
one of several arbitrary style-transfer targets it was trained against
alongside things like Van Gogh and anime-style rendering — but this is a
broad, experimental edit-anything adapter, not a watercolor-specific model,
and its watercolor fidelity is unverified. Style differentiation for
`watercolor` should rely on prompt guidance only until a dedicated LoRA
surfaces.

Not registered in the worker manifest. Activation requires Daniel to run the paid Novita benchmark per `docs/LTX_2_5_RTX_4090_OPERATIONAL_CONTRACT.md` — do not add to `ltxCreativeAdapter.ts`'s manifest until that passes.

---

## Style: cinematic_heist_noir / heist-documentary

### 1. Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients (official)
- **Source:** https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients
- **What it does:** An official Lightricks IC-LoRA that conditions generation on a single reference sheet image inventorying a scene's characters, props, and location, then holds those elements visually consistent (face, clothing, props, background) across generated shots. Recommended LoRA strength per community guides is ~1.4, and prompts should begin with the literal token `reference:`.
- **Why it fits:** A heist narrative needs the same crew, disguises, and props to read identically across many cut shots (planning montage, approach, job, getaway) — this is precisely the reference-sheet consistency problem Ingredients was built for.

Not registered in the worker manifest. Activation requires Daniel to run the paid Novita benchmark per `docs/LTX_2_5_RTX_4090_OPERATIONAL_CONTRACT.md` — do not add to `ltxCreativeAdapter.ts`'s manifest until that passes.

### 2. Lightricks/LTX-2-19b-IC-LoRA-Canny-Control (official)
- **Source:** https://huggingface.co/Lightricks/LTX-2-19b-IC-LoRA-Canny-Control
- **What it does:** Official Canny-edge control IC-LoRA trained on LTX-2-19b; extracts structural edges from a reference video and applies that structure to a new generation independent of the reference's visual style.
- **Why it fits:** Heist/thriller camera doctrine (long lenses, surveillance framing, precise blocking) can be locked from a reference plate while the noir/heist visual style is carried entirely by the text prompt and lighting direction — separating motion/structure from style is the point of IC-LoRA control models.

Not registered in the worker manifest. Activation requires Daniel to run the paid Novita benchmark per `docs/LTX_2_5_RTX_4090_OPERATIONAL_CONTRACT.md` — do not add to `ltxCreativeAdapter.ts`'s manifest until that passes.

### 3. Lightricks/LTX-2-19b-IC-LoRA-Depth-Control (official)
- **Source:** https://huggingface.co/Lightricks/LTX-2-19b-IC-LoRA-Depth-Control
- **What it does:** Official depth-map control IC-LoRA trained on LTX-2-19b for geometry-aware, structure-preserving generation from a reference video's depth signal.
- **Why it fits:** Heist set-piece geography (vault interiors, corridors, stakeout vantage points) benefits from depth-locked staging so cuts stay spatially coherent across a multi-shot sequence, complementing the noir framing controlled by prompt/style.

Not registered in the worker manifest. Activation requires Daniel to run the paid Novita benchmark per `docs/LTX_2_5_RTX_4090_OPERATIONAL_CONTRACT.md` — do not add to `ltxCreativeAdapter.ts`'s manifest until that passes.

---

## Style: documentary_mannequin

### 1. Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients (official)
- **Source:** https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients
- **What it does:** See description above — reference-sheet-driven character/prop/scene consistency IC-LoRA, official Lightricks release.
- **Why it fits:** "Documentary mannequin" reconstructions (dramatized recreations of real events with consistent stand-in actors/props across many cutaways) are exactly the multi-shot consistency problem Ingredients targets — the same reconstructed "cast" and evidence props must read identically shot to shot the way a real documentary recreation would demand.

Not registered in the worker manifest. Activation requires Daniel to run the paid Novita benchmark per `docs/LTX_2_5_RTX_4090_OPERATIONAL_CONTRACT.md` — do not add to `ltxCreativeAdapter.ts`'s manifest until that passes.

### 2. Lightricks/LTX-2-19b-IC-LoRA-Pose-Control (official)
- **Source:** https://huggingface.co/Lightricks/LTX-2-19b-IC-LoRA-Pose-Control
- **What it does:** Official pose-control IC-LoRA trained on LTX-2-19b for precise character motion and body-structure control conditioned on a reference video.
- **Why it fits:** Reenactment-style documentary footage often needs to match a real reference gesture or blocking (e.g. recreating a known incident's motion) while the "mannequin"/dramatized visual treatment is carried by the prompt — pose control gives that structural fidelity independent of style.

Not registered in the worker manifest. Activation requires Daniel to run the paid Novita benchmark per `docs/LTX_2_5_RTX_4090_OPERATIONAL_CONTRACT.md` — do not add to `ltxCreativeAdapter.ts`'s manifest until that passes.

---

## Style: music_video_cinematic

### 1. LTX 2.3 Music Video Creator (vrgamedevgirl84)
- **Source:** https://huggingface.co/vrgamedevgirl84/LTX_2.3_Music_Video_Creator_ComfyUI (LoRA collection: https://huggingface.co/collections/vrgamedevgirl84/ltx-23-loras)
- **What it does:** A two-part ComfyUI workflow set (not a single LoRA): a "Prompt Creator" workflow that analyzes an uploaded song's beats/lyrics/timing and auto-generates per-scene prompts, feeding a second T2V/I2V generation workflow (LTX 2.3 + optional LoRAs, "Remake Mode", automated scene stitching) that renders the final music video.
- **Why it fits:** It is purpose-built for automated, beat-synced, multi-scene music-video generation — the exact production pattern `music_video_cinematic` targets — though as a ComfyUI *workflow* rather than a hosted-API-compatible LoRA file, it is a pattern/reference rather than a directly droppable adapter for this repo's Novita-hosted pipeline (see `src/lib/novitaDirectRender.ts`, which calls Novita's hosted API and has no ComfyUI layer).

Not registered in the worker manifest. Activation requires Daniel to run the paid Novita benchmark per `docs/LTX_2_5_RTX_4090_OPERATIONAL_CONTRACT.md` — do not add to `ltxCreativeAdapter.ts`'s manifest until that passes.

### 2. LTX 2.3 Soft Enhance Style LoRa (vrgamedevgirl84)
- **Source:** https://huggingface.co/vrgamedevgirl84/LTX_2.3_Soft_Enhance_Style_LoRa (part of https://huggingface.co/collections/vrgamedevgirl84/ltx-23-loras, which also lists a "Crisp Enhance Style LoRa" counterpart)
- **What it does:** A finishing/beautifier-style LoRA that adds subtle detail and clarity while softening LTX 2.3's default contrast characteristics, for a smoother, more natural final look; the collection's "Crisp Enhance" sibling pushes the opposite, sharper cinematic-beautifier direction.
- **Why it fits:** Music-video cinematography often wants a stylized finishing pass (soft glow vs. crisp high-contrast) layered on top of the base render — this is a general look-grading LoRA in the same creator ecosystem as the Music Video Creator workflow above, useful for tuning `music_video_cinematic`'s finishing style independent of scene content.

Not registered in the worker manifest. Activation requires Daniel to run the paid Novita benchmark per `docs/LTX_2_5_RTX_4090_OPERATIONAL_CONTRACT.md` — do not add to `ltxCreativeAdapter.ts`'s manifest until that passes.

---

## SOLRICKS ComfyUI workflow — evaluation (not integrable, reference only)

**Source:** https://huggingface.co/SOLRICKS/ltx-2-5-t2v-i2v-audio-comfyui-workflow (confirmed to exist and re-fetched during this research pass).

**What it is:** A ComfyUI (self-hosted node-graph) workflow for LTX-2.5 T2V/I2V generation with audio, offering: (a) a two-stage generation-and-refinement setup for higher quality output, and (b) a simplified single main control node from which T2V vs. I2V mode, sampler/CFG/resolution/fps/seed, and prompt enhancement are all switched without rebuilding the node graph.

**Evaluation against this repo:**
- **Confirmatory, not integrable.** This repo (`youtube-studio-ai`) calls Novita's *hosted* LTX-2.5 API directly via `src/lib/novitaDirectRender.ts` and has no ComfyUI node-graph layer anywhere in the stack. The SOLRICKS workflow is a ComfyUI artifact — it cannot be dropped in as a dependency here. Its value is confirmatory: its two-stage generate-then-refine structure independently validates that this repo's existing two-stage-refine approach (see `docs/LTX_2_5_RTX_4090_OPERATIONAL_CONTRACT.md`'s distilled stage-one `640×352` render followed by native latent x2 spatial refinement to `1280×704`) already matches current community best practice for LTX-2.5.
- **UX reference only.** The workflow's "everything from one simplified main node" pattern is worth noting as a UX precedent for any future internal control surface, but is out of scope for the current Novita-direct architecture.
- **Future option, explicitly out of scope now.** If a self-hosted-ComfyUI fallback path to (or instead of) the Novita hosted API is ever pursued, this workflow (and the broader IC-LoRA ecosystem cited above, which is itself ComfyUI-node-based) would be the natural starting point, since community LoRA distribution for LTX is overwhelmingly ComfyUI-first. No such fallback exists today and none is proposed by this document.

This section evaluates a workflow, not a registrable creative adapter, so the standard manifest-gating sentence does not apply to it directly. Any individual community LoRA surfaced through a future ComfyUI path would still be subject to the same gate: not registered in the worker manifest, activation requires Daniel to run the paid Novita benchmark per `docs/LTX_2_5_RTX_4090_OPERATIONAL_CONTRACT.md` before it is ever added to `ltxCreativeAdapter.ts`'s manifest.
