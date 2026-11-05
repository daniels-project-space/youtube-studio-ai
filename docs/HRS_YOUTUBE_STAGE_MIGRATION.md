# YouTube Studio to Hyper Render Service: stage handoff

This inventory describes the local integration, not production activation. H3 is paused.
The project-scoped HRS credential and API base URL must be configured in the
deployed YouTube Studio runtime. The clients resolve the project ID and output
destination from HRS `/api/v1/projects/self`; neither is separately configured.

| Stage | Current app caller | HRS equivalent | Work needed before switching the app |
| --- | --- | --- | --- |
| Thumbnail | `thumbnail_gen` in `src/trigger/blocks/intelligenceBlocks.ts` and `genThumb` in `src/trigger/planWeekAhead.ts` | Project-scoped `youtube/thumbnail-candidates`, Google Gemini Nano Banana Pro | This worktree connects both callers. Review and release the app and HRS changes together, configure the project token and R2 binding, and exercise a user-authorized production request. Candidate identity and the verified receipt are retained; uncertain work is observed without another generation. |
| Narration | `narration_tts` in `src/trigger/blocks/narratedBlocks.ts`, through `src/lib/tts.ts` and `src/lib/qwenTts.ts`; lore also calls `synthNarration` | `qwen3-tts` project job or YouTube weekly batch; accepts text, speaker, language, instruction and seed, returns verified project R2 WAV | Adapt chunk submission and resumption to project jobs. Preserve the selected voice, instructions, timing and source evidence. Existing validation requires a pinned Qwen worker receipt, so an HRS-specific receipt contract and downstream evidence migration are required. |
| Music | New HRS version of `src/trigger/blocks/yue2Music.ts`; previously pinned runs retain their legacy version | `yue2` project job; submits the accepted instrumental direction, empty lyrics, ABC and seed, and verifies project R2 FLAC | The HRS candidate has its own unreported-cost receipt and lossless FLAC-to-float-WAV adapter; audition, approval and assembly still require their own evidence. Requested and measured duration remain distinct. Production requires an HRS worker/API that accepts empty instrumental lyrics and a real source proof. |
| Scene images and artwork | `lofiBlocks.ts` now submits its keyframe to HRS. `motionComicBlocks.ts`, `whiteboardScribeBlocks.ts`, `documentaryCollageShortBlocks.ts`, `loreShortBlocks.ts`, and `genFootageBlocks.ts` retain Novita-specific image functions. | `ernie-image-turbo` project job or YouTube weekly batch; accepts a prompt and optional seed, returns verified project R2 PNG | The lofi path explicitly embeds the complete square image without resampling on a 16:9 blurred extension and verifies the resulting project R2 image. Other modules still need their aspect ratio, reference, per-shot identity and image-review requirements preserved. The HRS native ERNIE route accepts no image input or per-job dimensions, so reference-dependent workflows cannot simply be redirected. Replace provider-specific evidence only after an HRS equivalent is validated. |
| Other native model routes | Model-specific Studio modules must be mapped individually | HRS catalog exposes other non-H3 models globally, but the YouTube project policy allows only Qwen3-TTS, YuE2 and ERNIE Turbo | A global catalog entry is not evidence of a YouTube-permitted or app-integrated route. Confirm project policy and stage contracts before enabling a caller. |

The HRS weekly-batch route is an API for submitting stages; it does not itself
connect Studio's pipeline or establish compatibility with its persisted quality
evidence. No native GPU execution or paid Nano Banana test was performed as part
of this local migration review.
