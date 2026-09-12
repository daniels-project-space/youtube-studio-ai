# Comic story-completeness control-flow evidence

These are **controlled actual-cast/block tests, not generated media or visual-QA proof**. External image/speech/storage services, native process execution, and media measurements were controlled. No provider spend occurred. No fake MP4, image generation, or audio result is retained as a successful production artifact here.

- `art-before.json` and `art-before-input.json`: original source accepted a ten-panel story after the last image's primary and recovery failed. The real cast and block passed nine panels to the intercepted renderer, emitted nine narration cues, and the block recorded nine video panels.
- `voice-before.json` and `voice-before-input.json`: original source accepted eleven planned voice lines after one line in the last panel received an explicit controlled HTTP 400. The real cast and block returned only ten narration cues without surfacing the missing line.
- `valid-before.json` and `valid-after.json`: eight complete 4/8/10/12-panel cast/block variants retain identical renderer-input objects, narration concat lists, per-panel concat lists, padding arguments, sentence timings/order, narration text, and controlled duration handoffs. This is transport/logic parity, not a native encoded-media comparison.
- `after.json`: actual observed results for the permanent regression cases. Includes structured missing-content errors, intercepted provider requests, downstream process/upload calls, original cache hashes, and real engine/Trigger retry classifications. Completed assertions precede this file's generation.

Permanent executable oracle: `src/lib/__tests__/motionComicStoryCompleteness.test.mjs`.

`independent-retry-probe.mjs.txt` retains the separate reviewer's runnable probe as an archival text snapshot; `independent-retry-results.txt` records its 12 passing actual cast/block → remote-cost-wrapper → task-policy checks. It requires the exact frozen runtime hash and the permanent harness. The probe controls external I/O and inspects failure propagation/accounting; it does not execute a cloud Trigger task, generate native media or add a second CI test path.

The retained source baseline hash is `bad109aad913b7297170219eae68496b7f4bc1c2a47afbed6b2c269f04672568` (the pre-change `src/lib/motionComic.ts`, present at `ef645f3`). Running the new full oracle against that baseline fails on the behavioral counterexample **“renderer got 9/10 panels”**, not merely on a renamed error.

Scope limits: no new page-level generation, reference conditioning, hand-reveal design, provider/model change, full story-semantic assessment, real-world source verification, native-video QA, production deployment, or durable cold-worker recovery is proved by this fixture set. The existing case fixtures use valid structured synthetic stories; the controlled approved-story checkpoint is not an actual creative-model verdict.
