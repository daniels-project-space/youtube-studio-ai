# Script critic response admission — 9 September 2026

Status: held correction; not released or a newly qualified writing module.

## Root cause and scope

While tracing arithmetic preparation into the existing script QA → TTS path,
the real `qa_script` caller was found to accept an OpenRouter response containing
only `{}` as `scriptApproved: true`. Its `res.pass !== false` treated a missing,
null or string verdict as approval. The earlier `script_gen` critique loop used
the same false-only rejection logic. Generic TypeScript response parameters do
not validate provider JSON at runtime.

The retained before regression is `/tmp/ysa-script-critic-before.log`: the
actual caller, actual OpenRouter adapter and fixture-only HTTP transport fail
the expected-rejection assertion on the empty object. No live provider was
contacted.

Both script-critic call sites now use a small shared parser in the existing
`scriptQualityGate.ts`: an explicit boolean `pass`, a required array of at most
five nonempty text issues, and the existing prompt's 140-character issue bound.
Unknown response fields are not interpreted as another verdict schema. A
malformed response follows the existing unavailable-critic failure path;
it cannot approve the script or trigger blind regeneration. Explicit rejection
still uses the existing informed-retry policy. Explicit approval retains the
existing quality decision; this parser does not replace editorial judgment.

No model, prompt rubric, token ceiling, temperature, provider route, thumbnail
module, approval artifact, publishing policy or paid-media route was changed.
The independent hookcraft/hook-line reviewers are separate remaining review
work; this does not claim to harden every critic in the application.

## Evidence so far

- `src/trigger/blocks/__tests__/scriptCritiqueResponse.test.ts` exercises the
  actual `qa_script` and actual OpenRouter parsing/accounting with only HTTP
  transport replaced. Fourteen malformed response shapes reject; valid true
  and false responses retain their expected outcomes. Each malformed response
  consumes one fixture request, with its fixture charge still accounted.
- The same test uses `registerAllBlocks`, the real runner and declared-artifact
  proxy with `qa_script → narration_tts`. An empty critic response fails at the
  intended parser, produces no approval and never enters the paid TTS stage.
  The failed runner retains the consumed fixture charge.
  `/tmp/ysa-script-critic-after.log` exits 0.
- Independent `scriptCritiqueGenerationResponse.test.ts` exercises the actual
  registered `script_gen`, `synthScript`, `craftHook`, hook lint/judge and
  critique loop with only OpenRouter HTTP responses replaced. Fourteen malformed
  verdicts fail before regeneration; a valid first pass uses one draft; explicit
  rejection gets at most one informed narration retry with the judged hook
  reused and the exact issue in the next generation prompt. Two rejections or
  a malformed second critique never return a best-effort script. Root's
  independent rerun passes at `/tmp/ysa-script-critic-generation-root.log`.
- The unchanged generation oracle, using retained pre-change source loaded
  only in memory, fails on the empty verdict admitting `script_gen`.
  `/tmp/ysa-worked-example-independent-OUkI5V/script-generation-before.log`
  records exit1; the current source passes. These fixed fictional transport
  fixtures test admission and iteration, not the quality of a generated video.
- Existing script-quality and program-route runtime regressions pass:
  `/tmp/ysa-script-critic-quality-regression.log` and
  `/tmp/ysa-script-critic-route-regression.log`.
- Non-incremental typecheck and scoped lint pass:
  `/tmp/ysa-script-critic-typecheck.log`, `/tmp/ysa-script-critic-lint.log`.

An initial runner test incorrectly registered blocks without their real
contract overrides and failed on an undeclared read before reaching the
critic. `/tmp/ysa-script-critic-runner-debug.log` retains that failure. The test
now uses actual registration and asserts the exact failure reason, not merely
`ok: false`.

Full isolated release qualification and exact cloud deployment verification
remain pending. No
live creative-quality or complete-video improvement is claimed by these
response-shape tests.
