# YuE2 Program Identity

## Reproduced Mismatch

The scored composer reads the canonical frozen channel profile. The YuE2
program planner previously read loose `styleDNA` and `niche` seeds instead.
Contradictory seeds could therefore seal a program with different instruments,
setting, and motion vocabulary from the composer's channel identity.

The regression fixture deliberately supplies stale city/electronic identity
alongside a frozen coastal piano or woodland ambient identity. The old v2
planner reproduces the stale identity; the new version does not.

## Versioned Fix

`music_program_plan@2.1.0-yue2-frozen-identity` requires the current channel's
frozen profile and reads its Style DNA and niche. Absent canonical fields stay
absent instead of falling back to contradictory loose seeds. Missing, malformed,
and different-channel profiles are rejected. Episode crew briefs and explicit
module parameters retain their existing precedence; no source audio, approval,
or legacy channel is changed.

The selected manifest validates the input using the existing ChannelProfile
schema, including its optional fields, rather than generic migration JSON.
Creator validation declares the runtime profile seed only for this exact new
version. Fresh ordinary runs already construct that profile before execution.
Old snapshots and private contexts are not silently backfilled.

New explicit YuE2 loop designs select this version. The default legacy planner
and `2.0.0-yue2-intent` remain registered with their original behavior. Existing
explicit version pins are not overwritten. No automatic-production admission
or browser launch option is enabled.

## Evidence

Eight focused files passed with external networking disabled:

- New and old planner behavior with conflicting identities, canonical omissions,
  missing/malformed/foreign profiles, and input immutability.
- Actual runner execution through declared manifest inputs, producing the same
  sealed plan as direct execution for two distinct channel identities.
- Conditional creator seed projection and preserved historical seed contracts.
- Five family/playback selections, cold preview, and actual worker-option
  projection with exact preview/execution parity.
- Existing crew identity, arrangement handoff, route runtime, source-approval,
  and per-take revocation checks.

These checks use synthetic provider boundaries; they do not certify musical or
visual quality. No thumbnail tests, GPU work, legacy pipeline migration, or
production deployment were performed.
