# Opt-in channel-aware script critic

## Baseline

The shared script generator supplied channel style grammar and critic doctrine
to its review loop, but the later `qa_script` gate omitted both. That final gate
unconditionally demanded an argumentative point of view and a midpoint re-hook,
even when the channel's authored guidance described calm guided listening.

The regression captures the actual legacy prompt and proves both omissions and
the unconditional requirements. It does not claim a live model rejected a real
meditation script; the test's model transport is synthetic.

## Explicit replacement

`qa_script@2.0.0-channel-aware` is registered as a selected executable revision.
Existing pipelines and default module discovery continue using the legacy
implementation. The test compares the legacy prompt byte-for-byte before and
after invoking the selected revision.

The new revision:

- Requires a frozen channel name and authored personality, style or critic
  guidance before buying a verdict. It does not substitute generic review when
  that context is missing.
- Declares and forwards the existing bounded channel critique context, including
  style grammar, critic doctrine and lane emphasis.
- Judges pacing, clarity, purpose and distinctiveness against that context.
  A thesis, dramatic escalation or re-hook is required only when the accepted
  channel/route guidance calls for it, not because all videos must share one form.
- Still requires payoff of the actual authored opening promise and retains all
  route, serialized continuity, reviewed-claim, strict-verdict and paid TTS gates.
  Personality cannot waive factual/source, disclosure or safety requirements.
- Keeps the configured critic route, token ceiling, temperature, narration
  sampling and usage accounting. No model downgrade, extra critic call or
  automatic regeneration is introduced.

An explicitly composed pipeline selects it with:

```ts
{ block: "qa_script", version: "2.0.0-channel-aware" }
```

This is not an automatic creator migration, a new browser authority, or a
qualification claim. Exact-version selection uses the existing compiler/runner
path; no second critic service or disconnected catalog card is added.

## Verification

Seven focused test files passed with external networking disabled. They cover
three distinct channel briefs (calm listening, argumentative essay, short form),
missing-context refusal, explicit version resolution, declared artifacts, legacy
prompt parity, strict critique responses, reviewed claims, route runtime and
composition contracts. The actual runner preserves a rejected fixture verdict's
cost and stops before narration with one critic call.

Scoped ESLint and the production build, including TypeScript, passed. Logs:
`/tmp/studio-channel-critic-regressions.log` and
`/tmp/studio-channel-critic-build.log`.

Real model verdict calibration and retained per-channel before/after outputs are
still required. No live model/GPU calls, thumbnail work, channel mutation,
publishing or production deployment occurred. The full MVP/backlog remains open.
