# Open-source production acceleration: adoption record

This is a decision record, not a claim that the tools below are already live.
Each candidate must be invoked through a typed, cacheable module, emit an
evidence receipt, and be validated with a rendered fixture before it can affect
an upload decision. No candidate creates a Google/Gemini dependency.

## Adopt next: four narrow integrations

| Priority | Component | Exact job in this system | Why it is a good fit | Release constraint |
| --- | --- | --- | --- | --- |
| P1 | [WhisperX](https://github.com/m-bain/whisperX) (BSD-2-Clause) | GPU forced alignment of the *final mix* to the approved script; word cues, narration coverage, caption drift and speaker evidence. | Replaces guessed sentence timings with time-accurate, locally produced evidence and unlocks karaoke captions plus multilingual narrator lanes. | Run on the existing 4090 worker as an explicit `speech_alignment` module. A mismatch must fail/repair captions, never rewrite the script or audio silently. |
| P1 | [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) (BSD-3-Clause) | Cache real shot boundaries for stock footage and final render review; give the editor legitimate cut points. | Small, mature CLI/Python dependency that complements the existing FFmpeg detector. It prevents generic fixed-cadence cuts through pans or shot changes. | Introduce it first as advisory `shot_analysis`, compare against fixtures, then allow EDL snapping only within a typed tolerance. |
| P1 | [libvmaf / FFmpeg libvmaf](https://github.com/Netflix/vmaf) (BSD+Patent) | Compare a pre-encode master with the final deliverable to catch encoding/upscale degradation, banding and resolution regressions. | This is perceptual *fidelity* QA, not a proxy for story quality. The system already uses FFmpeg, and VMAF has an FFmpeg integration. | The current local FFmpeg build does **not** expose `libvmaf`; add it as an explicit worker-image capability. Require a same-duration, same-frame-rate reference artifact. Never assign a VMAF score to an AI clip without a reference, and never use it as the sole visual-quality gate. |
| P2 | [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) (MIT or Apache-2.0) | A narrowly scoped narration-cleanup repair when deterministic meters or audio QA identify actual noise. | Efficient 48 kHz speech enhancement with a CLI; helpful for reused archival/field narration, not a replacement for good TTS or mixing. | Opt-in repair only. Keep the original, re-measure loudness/transcript alignment, and reject a repair that changes intelligibility or causes artifacts. |

## Keep as analysis-only until proven

| Component | Useful capability | Why it is not an automatic production editor yet |
| --- | --- | --- |
| [auto-editor](https://github.com/WyattBlue/auto-editor) | Finds silence/motion intervals and can export editorial timelines. | A silence cut can damage deliberate comedic, documentary, children’s-learning and music timing. Use it to propose a repair window, never to remove content autonomously. |
| [TransNet V2](https://github.com/soCzech/TransNetV2) (MIT) | Neural shot-boundary detection; potentially stronger on soft transitions than simple scene thresholds. | It adds a heavier model/runtime than PySceneDetect. Benchmark it only if PySceneDetect produces incorrect cut evidence on our real reference renders. |
| [RIFE](https://github.com/hzwer/ECCV2022-RIFE) | Frame interpolation. | It can create warping around generated motion and conceal a bad shot. Native LTX 2.5 two-stage refinement remains the quality route; interpolation is not an upscale substitute. |

## Deliberately not the production path

- [ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo) is valuable as an official workflow laboratory and regression reference. The direct, pinned LTX 2.5 Novita worker remains the production runtime because it has typed inputs, reproducible component hashes, completion proof, cost gates and no UI queue state.
- Real-ESRGAN video upscaling is not reinstated. It is a separate temporal model with a different artifact profile; the selected LTX 2.5 two-stage path performs its native spatial refinement to the 1280×704 delivery frame and is already covered by an exact attestation contract.

## Integration contract for every candidate

```text
input artifact + content hash
    -> module-specific analysis/repair
    -> versioned JSON receipt + derived artifact(s)
    -> QA compares receipt against lane policy
    -> publish gate consumes only a passing, provenance-matched receipt
```

No module is allowed to edit the master or change a timing plan just because it
is available. It needs an owning block, an explicit repair policy, a cost/
hardware declaration, fixture coverage, and a measurable acceptance rule.
