# Title profile pass — 11 September 2026

This is a bounded title-engine pass. It changes the deterministic profile and
prompt contract; it does not claim a CTR or virality lift without a controlled
watch-time experiment.

## Research translated into rules

YouTube's current creator guidance says titles should be accurate and
succinct, put the important words near the beginning, and be chosen as either
searchable or intriguing based on the intended audience and discovery surface.
It also warns that overly complex packaging can overwhelm viewers and that
tags have a comparatively small discovery role. Sources:

- https://support.google.com/youtube/answer/12340300
- https://support.google.com/youtube/answer/16559650
- https://support.google.com/youtube/answer/146402

The implementation therefore keeps honesty/grounding as a hard gate, makes
discovery intent explicit per format, and treats concise front-loaded meaning
as a deterministic tie-break signal—not as a made-up CTR predictor.

## Change

`src/lib/metacraft.ts` now exposes eight bounded `TitleProfile` envelopes:
`browse_long`, `searchable_long`, `serialized_lore`, `motivational`,
`children_quiz`, `music_loop`, `short_form`, and a backward-compatible
`general` profile. `resolveTitleProfile` maps an explicit route setting first,
then the durable content lane/family/niche. The same profile is passed to the
generator and judge, so the two calls no longer optimise conflicting length or
discovery goals.

Each profile has forgiving hard bounds (never above YouTube's 100-character
ceiling) and a tighter target band used for generation guidance and the local
tie-breaker. `titleQualitySignal` now records `frontLoadedTerms`,
`inTargetBand`, and the profile id, and applies a small generic-opening penalty.
The provider judge remains authoritative; these local signals only break an
otherwise equal judge score and add no provider/Convex/Trigger work.

Before the judge, exact duplicates are now followed by a conservative lexical
paraphrase guard. It removes only candidates with at least three shared content
terms and ≥0.8 Jaccard or ≥0.92 containment; distinct search, curiosity and
verdict hypotheses remain in the pool. This is intentionally embedding-free and
therefore adds no paid call or latency budget.

## Verification

- `metacraftTitleQuality.test.ts` covers lane/profile resolution, short-form
  hard bounds, front-loaded term measurement, and the unchanged judge-primary
  ordering guarantee.
- Existing title gate, warm-start, metadata authority and title-review tests
  remain green.
- No paid generation or production data mutation was performed for this pass.

The next evidence step is a frozen, held-out corpus comparison with repeated
controls and owner-approved selections. Until that is run, profile fit is a
measured structural improvement, not a claim about audience performance.
