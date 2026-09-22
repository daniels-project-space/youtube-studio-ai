# Frozen channel identity in creative briefs

## Reproduced defect

`loadGrounding` correctly preferred the immutable `channelProfile`, including its
Show Bible, persona, style grammar and audio DNA. `crewCtx` then overwrote the
profile's name and niche with redundant loose seed fields. Conflicting seeds
therefore produced a prompt combining one channel's creative identity with
another name/category. The same adapter feeds director, cinematographer, editor,
composer and critic; the scored YuE2 composer also retained that mixed identity
in its review context.

The actual director prompt failed the new regression before the repair. When a
profile exists, its identity is now authoritative, including an absent niche.
Historical invocations without a profile retain their previous loose-seed path.
No channel records, templates, default creative instructions or module controls
are changed.

## Verification

`crewFrozenIdentity.test.ts` executes all five actual brief producers plus the
scored YuE2 composer with three distinct profiles and conflicting loose seeds.
It checks actual provider-bound prompts, malformed-profile rejection before
dispatch, unchanged input objects, historical behavior and the composer's
review-context handoff through arrangement acceptance. Only the text provider
is replaced with schema-validated fixtures; external networking is forbidden.
The fixture score is not an executable composition or musical evidence.

The new regression, arrangement-block execution, frozen-profile parser/wiring,
and crew-configuration checks pass. Typecheck and scoped lint pass. This proves
identity propagation, not creative output quality, listener approval or a live
production deployment. No GPU work or thumbnail tests were performed.
