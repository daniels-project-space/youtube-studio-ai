# YouTube Studio to Hyper Render Service: stage handoff

This inventory describes the local integration, not production activation. H3 is paused.
The project-scoped HRS credential and API base URL must be configured in the
deployed YouTube Studio runtime. The clients resolve the project ID and output
destination from HRS `/api/v1/projects/self`; neither is separately configured.

| Stage | Current app caller | HRS equivalent | Work needed before switching the app |
| --- | --- | --- | --- |
| Thumbnail | `thumbnail_gen` in `src/trigger/blocks/intelligenceBlocks.ts` and `genThumb` in `src/trigger/planWeekAhead.ts` | Project-scoped `youtube/thumbnail-candidates`, Google Gemini Nano Banana Pro | This worktree connects both callers. Review and release the app and HRS changes together, configure the project token and R2 binding, and exercise a user-authorized production request. Candidate identity and the verified receipt are retained; uncertain work is observed without another generation. |
| Narration | `narration_tts` in `src/trigger/blocks/narratedBlocks.ts` and `planWeekPreparedNarration.ts`; lore also calls `synthNarration` | `qwen3-tts` project jobs; accepts text, speaker, language, instruction and seed, returns verified project R2 WAV | Modular and weekly Qwen callers retain chunk receipts and final-source evidence. Weekly preparation requires its existing exclusive dispatch claim; an incomplete claim still requires reconciliation. Lore and non-Qwen provider contracts remain independent. |
| Music | HRS version of `src/trigger/blocks/yue2Music.ts`; previously pinned runs retain their legacy version | `yue2` project job; submits the accepted instrumental direction, empty lyrics, ABC and seed, and verifies project R2 FLAC | Weekly preparation admits the exact HRS pipeline pins and defers music to the scheduled composer, arrangement, HRS source, audition and assembly modules. It cannot pre-generate a mastered track before the run-bound scored arrangement and owner audition exist. The old prepared producer reads historical receipts but refuses new work. Requested and measured duration remain distinct. |
| Scene images and artwork | `lofiBlocks.ts` and the versioned weekly still consumer use HRS ERNIE. `motionComicBlocks.ts`, `whiteboardScribeBlocks.ts`, `documentaryCollageShortBlocks.ts`, `loreShortBlocks.ts`, and `genFootageBlocks.ts` retain their separate image functions. | `ernie-image-turbo` project jobs accept a prompt and optional seed, returning verified project R2 PNG | Lo-Fi explicitly embeds the square image on a 16:9 blurred extension. New weekly freezes retain the certified operation ID `novita_render_images`, but pin its HRS-only `2.0.0-hrs-ernie` implementation with Hyper provider metadata; the existing asset QA still applies. A new `hyper_render_images` ID requires separately qualifying the sealed program, content-lane and composition contracts. HRS ERNIE does not accept image conditioning or per-job dimensions. |
| Other native model routes | Model-specific Studio modules must be mapped individually | HRS catalog exposes other non-H3 models globally, but the YouTube project policy allows only Qwen3-TTS, YuE2 and ERNIE Turbo | A global catalog entry is not evidence of a YouTube-permitted or app-integrated route. Confirm project policy and stage contracts before enabling a caller. |

The weekly image producer stores native HRS ERNIE candidates and receipts under
a separate prefix. It holds items that require an image reference, since its HRS
request sends `inputRefs: []` and exposes only prompt and seed. The old still
manifest declares a different pinned model, dimensions and precision. The
scheduled still consumer can admit a distinct ERNIE manifest only after checking
the project job, checkpoints, bytes, exact shot mapping and runtime visual
directives. Reference-required or mismatched items stay held, and the existing
asset QA thresholds still apply. H3 video remains paused. Text mentioning a
reference is not image conditioning. Lo-Fi's existing square-image composition
has a separate explicit contract.

The HRS weekly-batch route is an API for submitting stages; it does not itself
connect Studio's pipeline or establish compatibility with its persisted quality
evidence. No native GPU execution or paid Nano Banana test was performed as part
of this local migration review.
