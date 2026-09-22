# Weekly script review before narration spend

## Reproduced defect

At `5f51d50f`, the weekly script producer saved its Script and queued the weekly
narration task, which could purchase TTS without calling the independent
`qa_script` gate. The normal pipeline's later review could not prevent that
earlier expense.

The regression loads the actual previous narration-task source from Git. With
a deliberately rejecting critic transport, the previous task reaches the TTS
boundary instead of returning the opening-promise rejection. This is a real
task/control-flow counterexample with synthetic provider transport, not a claim
about a live model's creative judgement.

## Connected repair

New weekly narration takes now run the existing default script critic after
deterministic voice/configuration/budget checks and before TTS credentials,
the narration dispatch claim, or synthesis. Direct task invocations and the
automatic script handoff enter the same gate. A frozen pipeline must contain
one `qa_script` before `narration_tts`; unsupported explicit weekly versions
still refuse rather than falling back to another implementation.

The review consumes the retained script and frozen channel/route/evidence
context. Its prompt, model, token ceiling and strict verdict parser remain the
existing critic's. This does not silently select the new channel-aware version.

A create-only review claim precedes the actual OpenRouter dispatch. A separate
immutable review receipt binds the full preparation-manifest digest and exact
script digest, verdict state, model and known usage. Rejected, malformed,
unpriced and uncertain outcomes remain held. A failed claim cannot write a
competing verdict; a lost result write cannot authorize another review purchase.
No claim is deleted or expired to retry.

Before dispatch, the exact prompt's UTF-8 bytes plus framing and the output
ceiling provide a conservative configured-rate reservation. Review admission
also reserves the existing narration estimate. On recovery, the saved review
charge still reduces the narration allowance even though reusing that review
incurs no new charge. Usage uses the shared reported/configured-cost rules;
unknown outcomes are not proof of zero provider billing.

Existing completed narration remains reusable without buying another review
or another take. Normal scheduled-pipeline review remains intact: this new
preparation receipt is not presented as a general stage-reuse certificate or
permission to bypass later review of changed inputs. Thus a fresh preparation
adds one early critic call; avoiding later duplicate judgement requires a
separately qualified exact-context handoff. The immediate saving is preventing
TTS and its downstream preparation when that critic rejects, not a claimed
fleet-wide billing reduction.

## Web boundary

The initial implementation exposed an existing dependency coupling: the web
narration dispatcher imported argument validation from the worker task. Adding
the critic caused Remotion/native rendering dependencies to enter the Vercel
build, which failed. The unchanged validator now lives in a shared library,
and the task re-exports it for existing callers. The corrected production
build passes. Its narration-route NFT trace contains 340 files and no Remotion,
renderValidate, script-review-worker or Graphify files.

## Verification

- Actual task, critic and HTTP parser tests cover rejection before TTS,
  malformed verdicts, unpriced/over-ceiling usage, absent critic authority,
  budget refusal before dispatch, charge preservation on recovery, changed
  script refusal, lost write acknowledgement, failed receipt persistence,
  concurrent deliveries and no-provider review reuse.
- The previous task fails the opening-promise regression by reaching TTS.
- All 885 selected readiness files passed on the frozen final source;
  30 thumbnail-named files were excluded. This is not the complete production
  release gate. Log: `/tmp/studio-weekly-script-review-readiness-20260922.log`.
- Production build including TypeScript, scoped ESLint and structural audits
  passed. No audit baseline changed or regressed; undeclared store reads remain
  zero. Audit log: `/tmp/studio-weekly-script-review-audit-20260922.log`.
- Graphify was updated after the final source edit.

No live model/GPU calls, channel migration, thumbnail generation, publishing,
owner approval or production deployment occurred. Real model calibration,
weekly originality/compliance parity before paid preparation, live prepared
workflow qualification and the full module-first MVP/backlog remain open.
