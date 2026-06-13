# CINECRAFT — character-consistent cinematic documentary engine (knowledge)

Status: **research + PoC validated, engine NOT built yet.** This file is the
proven knowledge to build the engine from. A new GENERATED-cinematic visual
family (vs the stock-footage `footagecraft` family), for true-crime / history
documentary channels in the **Cipher / "ago."** style: narration-driven, but
characters are AI-generated and stay CONSISTENT across many reconstructed
multi-shot scenes (face + body + period wardrobe).

Reference targets (YouTube): pwjyH3Qi-KI (Eiffel-Tower con), kVlbMBqoa3A
(North Hollywood shootout), ObeM5aja834 (drug lord).

## The pipeline (proven end-to-end on the Lustig PoC)

1. **Cast extraction** — parse the script (scriptcraft output) into scenes/beats
   and a CAST: the recurring people essential to the story + their period look.
2. **Character design** — per character, generate a **character sheet** with
   Nano Banana (Higgsfield `nano_banana_2`): one strong HERO render, then more
   angles/expressions by passing the hero's job-id as `--image` so the face +
   wardrobe stay locked. **Operator approves the look BEFORE any Soul training.**
3. **Soul + registry** — train a Higgsfield **Soul ID** on the approved set and
   TRACK it (per owner/channel/story) so characters are reused. (~$2.50, once.)
4. **Cinematic shot-script** — a director model turns each narration beat into a
   shot with: setting, action, keyframe prompt, **camera move, lens, mood,
   transition**, and the i2v motion prompt. (Validated — produces real camera
   grammar: push-in / dolly / steadicam pull-back / handheld, match-cut / whip /
   dip-to-black.)
5. **Keyframe per shot** — see CONSISTENCY below. Anchor every keyframe to the
   ONE canonical hero image.
6. **Motion** — Seedance 1.5 (cheap) or Kling 3.0 (start+end image) i2v the
   keyframe with the camera-move prompt. Endframe-chain shot N's last frame into
   shot N+1 for continuity.
7. **Assemble** — Remotion timeline + narration + word-captions + music + grade
   (the existing golden pipeline tail).

## CONSISTENCY — the hard-won core lesson

**The trained Soul is NOT enough to lock identity in keyframes.** First PoC
render came out as "4 different people" (vision-scored 2/10 — the thin mustache
appeared/disappeared, jaw/nose/age drifted), even though the training set was
9/10 consistent.

Vision-measured comparison (same scene, scored against the canonical hero):
| keyframe method | identity match | mustache kept |
|---|---|---|
| `soul_cinematic --custom_reference_id <soul>`, generic prompt | 2/10 | no |
| `soul_cinematic`, scene-only prompt + explicit "keep his exact face+mustache" | 6/10 | yes-ish |
| **`nano_banana_2 --image <HERO_JOB_ID>`, prompt leads with identity-lock** | **9/10** | **yes** |

**Rules:**
- Keyframe = the **canonical hero render as a DIRECT `--image` reference**, not
  the trained soul. The soul drops fine features and locks loosely.
- The keyframe prompt **LEADS with the identity lock** ("This is the EXACT SAME
  man — identical face, same thin mustache, same hair, same suit. ") and then
  the scene/action — **never re-describe him generically** (that invites a new
  face) and **always name the distinctive features** (the mustache).
- Keep framing where the face is reasonably visible; extreme wides amplify drift.
- The Soul ID is still worth keeping for flexibility / extreme angles / as a
  secondary ref, but identity comes from the hero image.
- **Add a vision QA gate**: score each keyframe's face vs the hero, auto re-roll
  if < 8. (Same gate discipline as footagecraft / banana.)
- Multi-shot note: Soul ID drifts across multi-shot VIDEO (no Kling Motion
  Control); for native multi-shot consistency Seedance 2.0 is the purpose-built
  model. For our keyframe→i2v approach the hero-image anchor is what matters.

## Higgsfield facts (CLI, verified live — `export HIGGSFIELD_LIVE=1`)

- Soul training needs **UPLOAD ids**, not job ids: download the renders, then
  `higgsfield upload create <local>` → upload-id → `soul-id create --soul-2
  --image <upload_id>...`. Soul image gen uses `--custom_reference_id <soul>`.
- **Param names use underscores** (`--custom_reference_id`, `--aspect_ratio`),
  except media flags (`--image`, `--start-image`, `--end-image`) which take a
  job-id / upload-id / URL.
- Image models: `nano_banana_2` (Nano Banana Pro, 2cr ≈ $0.13), soul image
  models `text2image_soul_v2` / `soul_cinematic` / `cinematic_studio_soul_cast`.
- Video models + cost ($1 = 16 credits, ~5s clip): `seedance1_5` 4cr $0.25
  (prompt+medias+duration 4/8/12+res≤1080p; camera via prompt), `kling3_0` 10cr
  $0.63 (start+end image, mode pro/std/4k), `seedance_2_0` 22cr $1.38 (native
  multi-shot consistency), `veo3_1` 22cr $1.38 (+audio), `wan2_7` 7cr $0.44.
- **`cinematic_studio_video_3_5`** = the DIRECTOR model: explicit
  `camera_lens / aperture / focal_length / style`, `color_grading`, `genre`
  (action/horror/noir/drama/epic), `generate_audio`, 15s — the studio + camera
  direction layer to upgrade to beyond prompt-driven Seedance.
- **`soul_cast`** = soul-character → video directly (budget 50cr ≈ $3.13).
- **No LTX in Higgsfield.** LTX-2 (Lightricks, open-sourced Jan 2026) is the
  cheap wildcard via Lightricks/fal — a separate integration if wanted.

## Cost model
Per shot ≈ keyframe $0.13 + i2v $0.25 (Seedance 1.5) → ~$0.40, or +$0.63 (Kling).
A 20-min doc at ~120 shots ≈ $50–110 + ~$2.50 once per character. Mix generated
hero shots with cheaper stills/stock for connective tissue to control cost.

## To build (the generalized engine, on this proven path)
`src/lib/cinecraft.ts` (standalone, golden-shaped): `extractCast(script)` →
`designCharacter()` (Nano Banana sheet, operator-approve) → Convex
`soulCharacters` registry → `buildShotScript(script, cast)` (camera directions)
→ `renderShot()` (hero-anchored keyframe + vision gate → Seedance/Kling i2v) →
Remotion assembly. PoC scripts: `scripts/cinecraft-shotplan.ts`,
`scripts/cinecraft-render.mjs`.
