# Comic story completeness — 12 September 2026

Status: **committed at `e5f94ab`; frozen local release gate passed; exact production deployment still pending**. This closes two reproduced omission boundaries inside the current comic engine; it does not claim the page-generation/character-reference/hand-reveal rework is complete.

Reviewed runtime freeze: `src/lib/motionComic.ts` SHA256 `3eab4e712c4b7abcded4dad4fe0e4e9fdb335ea45a025f99e18707e0ea06db82`. The final 58-case run reproduces every retained case result in `after.json`; the final eight valid handoffs remain identical to the original baseline. No production release claim is attached to this local hash.

## Reproduced baseline defects

The baseline is `src/lib/motionComic.ts` at `ef645f3`, SHA256 `bad109aad913b7297170219eae68496b7f4bc1c2a47afbed6b2c269f04672568`.

1. **Missing art concealed a missing story beat.** With a valid ten-panel plan, panel 9's primary and recovery image calls both failed. The 90% art floor admitted the remaining nine panels. The real cast built a nine-panel timeline and rebuilt narration from those nine panels; the actual block recorded a nine-panel video at its controlled upload boundary. The final safety-inspection sentence disappeared. One opening failure or two late failures did block, so the defect depended on the percentage threshold rather than an unconditionally broken error path.
2. **One good voice line excused a missing second line.** A valid ten-panel, eleven-line plan received a controlled explicit HTTP 400 for the last panel's second narrator line. The old catch continued, the all-lines-lost check did not fire, and both real cast and real block returned ten cues. Rebuilding expected narration from successful files concealed the lost sentence from that downstream handoff.

The baseline evidence and accepted input fixtures are in `test-fixtures/comic-story-completeness/`. They are zero-spend actual-engine control-flow evidence. Native subprocesses and provider/measurement/storage I/O were controlled; these are **not finished videos or downstream visual-QA passes**.

## Root changes

- Require every normalized approved panel to have accepted art before any voice timing, voice generation, music, or page rendering. Errors expose exact `panel-N` IDs; accepted content-hash image caches are retained. No percentage-based success remains.
- Preserve the exact terminal image-provider error in both fallback catches: after a primary prebill rejection and after a near-black primary image. The generic missing-art error must not erase `retryable: false` and accidentally reopen paid retries.
- A failed voice provider call now immediately rethrows its **original error**, with missing panel/line identifiers attached. The existing terminal error class, HTTP status, cause, and `retryable: false` survive rather than becoming a generic error that Trigger might repeat.
- If both bounded local cache writes fail after a successful speech response, rethrow the original I/O error with `retryable: false`. Both writes use the same returned bytes; no second synthesis is started.
- Do not skip failed voice lines. Every accepted line must finish the existing voice/cache path, or its original failure aborts the collection. Gather complete voice inputs before padding panels, so even a last-panel voice failure performs no partial padding, music mux, or page render.
- Preserve the image provider/model/precision/resolution, image request/recovery bounds, speech provider retry loop, complete-script normalization, channel references, lettering, and current hand-reveal behavior. This is not a provider migration or a cheaper-quality substitution.

## Why the retry metadata is effective

`src/engine/runner.ts` runs `classifyExecutionError` before block retries and stops non-retryable errors. `src/engine/executionErrors.ts` gives explicit retryability precedence over network-looking text and status guesses. `src/trigger/runPipeline.ts` passes failures to `throwForTaskRetryPolicy`; `src/trigger/taskRetryPolicy.ts` converts deterministic failures into `AbortTaskRunError`.

The permanent test invokes the **actual classifier and task policy**, not a copied predicate. A transport failure after a potentially accepted speech POST remains the existing `TerminalDialogueResponseError` with its original transport cause. A double cache-write failure preserves the identical original `ENOSPC` error object. Both become `AbortTaskRunError`, and each affected line has exactly one intercepted provider POST. The cache-write case records two local writes of identical bytes. Additional HTTP 500, unreadable HTTP 200 body, and undersized HTTP 200 audio cases each preserve terminal status after one affected-line submission.

Both image-fallback cases retain the identical terminal recovery error, three already accepted images, and `AbortTaskRunError`; they start no speech, padding, music, render, or upload. The near-black case exercises the actual measured-image branch using a controlled `YAVG=0` result and Node-compatible `execFile` promisification, not a hand-written cast verdict.

This prevents automatic block/task repurchase under those tested terminal classifications. It does **not** create a durable speech-job recovery handle or prove that an operator-forced retry on a new worker can recover uncertain paid bytes; that remains separate work. The test deliberately does not force-resubmit an ambiguous request.

## Validation evidence

`src/lib/__tests__/motionComicStoryCompleteness.test.mjs` is automatically discovered by the existing production-readiness runner. It currently contains **58 actual cast/block executions**:

- Complete 4/8/10/12-panel stories through both the cast and production block.
- Missing opening, middle, last, and multiple art panels, with no downstream voice, music, render, or media-upload work.
- Art-only recovery that generates the missing image(s) while preserving every accepted image/manifest hash.
- A missing second narrator line in the first, middle, and last panel, followed by controlled recovery and a fully cached replay.
- Early voice recovery synthesizes the missing line **and not-yet-started later lines**; last-line recovery synthesizes only that single missing line. Accepted art and audio hashes remain unchanged. Fully cached replay performs zero image or speech requests.
- Outcome-ambiguous speech and double cache-write failures through both cast and block, with real terminal retry-policy checks.
- Primary prebill rejection and near-black-image recovery paths through both cast and block, preserving terminal recovery-error identity and abort policy.
- Speech HTTP 500, unreadable HTTP 200 body, and undersized HTTP 200 audio through both cast and block, with one affected-line submission and no derived media work.

The old source fails the new oracle specifically because it successfully sends **9/10 panels** to the renderer. This is a behavioral negative test, not an assertion tied only to the new diagnostic code.

For valid-output compatibility, eight 4/8/10/12-panel cast/block snapshots from the original and final source were compared. Their **actual renderer-input objects, narration concat lists, per-panel concat lists, padding arguments/order, sentence timings, narration text, and controlled duration handoffs are identical**. The snapshots are retained as `valid-before.json` and `valid-after.json`; comparison is independent of the completeness verdict. It proves unchanged valid handoff behavior, not native-video pixel or audio parity.

Focused checks passed: new completeness test, changed-file ESLint, Motion Comic art contract, keep-clear gate, final duration, series continuity, storyboard critique seam, self-contained story receipt entrypoints, Novita image stage contracts, and shared recovery policy. No full suite, Graphify update, commit, push, or deployment was initiated by this subtask. The parent owns the frozen release gate and exact production verification.

## Remaining work

Independent final review also passed 12 additional actual cast/block → real remote-cost-wrapper → task-policy probes, covering response-body failures, tiny audio, HTTP 500, exhausted bounded 429 attempts and both terminal fallback-art branches. The final reviewed runtime SHA-256 is `3eab4e712c4b7abcded4dad4fe0e4e9fdb335ea45a025f99e18707e0ea06db82`; permanent regression SHA-256 is `a14d4b427f44a5de41ab1b3c2463cda6bf52332a89358e72603d38465d2cebc3`. No blocker or weakened gate was found in this narrow final review.

The first local full sweep was explicitly stopped (exit 143) when review exposed the swallowed terminal art-recovery error; it is not passing release evidence. The corrected frozen sweep is `/tmp/comic-completeness-readiness-final-20260912.log`; build/typecheck/lint/audit/proof use the corresponding `*-final-20260912.log` paths. Exact terminal results and deployment remain the parent's next verification gate.

The corrected frozen command subsequently completed with **exit 0: all 685 direct production-readiness tests passed**, followed by actual hermetic assembly: **31.021995 seconds, 17,164.6 KiB, four segments, zero warnings**. This general assembly check does not pretend to be a new comic-quality render. Typecheck, production build, full lint (zero errors; 29 existing warnings), unchanged-bound structural audits and the defect-proof gate all completed successfully. The code graph was updated using AST extraction only (22,356 nodes / 53,815 edges), and stays excluded from deployment along with retained test fixtures. The source and permanent-test hashes above were rechecked after completion. No provider/model/resolution/precision changes or paid render requests were introduced.

Separately, the [native opening A/B experiment](../test-fixtures/comic-opening-reveal/README.md) retains two actual 1080p clips and 40 inspected samples. It confirms the prepainted opening and tests a shared hand-mask reveal without production changes. The candidate still needs framing/clearance and full narrated/multipage qualification; it is not part of this runtime release.

The larger comic rework remains open: one generated image per page, real immutable character-reference conditioning, complete ordered page-region reveals including the opening, faster readable tracing, native rendered A/B quality/cost measurements, durable paid-job recovery, and automatic unfamiliar-channel qualification. Existing valid duration/keep-clear tests do not substitute for those requirements.

Voice-cache qualification is also still incomplete: cached line audio is selected by `existsSync`, without a content/input fingerprint, and `probeDur` retains its existing fallback/minimum-duration behavior. These control-flow tests deliberately supply known cache inputs; they do not prove arbitrary cached speech is uncorrupted, matches the approved text/voice, or has valid natural timing. This batch does not expand into that separate cache-integrity repair.
