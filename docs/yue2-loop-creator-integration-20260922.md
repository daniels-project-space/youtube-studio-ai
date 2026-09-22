# YuE2 loop creator integration

This connects the explicit YuE2 creator selection to compatible loop modules.
It does not deploy the application, approve music, or complete the wider MVP.

## Integration repaired

The creator selected the shared YuE2 composer, candidate, and assembly versions,
but left the loop program on a legacy provider choice and animation expecting a
legacy `musicKey`. The source module could ignore the contradictory program,
and later animation could not consume the private reviewed candidate.

Explicit loop selection now chooses this complete owner sequence:

- `music_program_plan@2.0.0-yue2-intent`
- `scene_planner@3.0.0-bound-visual-plan`
- Existing shared scored composer, arrangement acceptance, and YuE2 candidate
- `keyframes@3.0.0-yue2-reviewed`
- `loop_clips@2.0.0-yue2-reviewed`
- Existing private reviewed-source loop assembly

Selection validates order, source role/playback, one owner per stage, conflicting
provider params, and explicitly pinned versions. Reselection is idempotent.
The existing source audition barrier still falls before paid visual generation.
Ordinary/default pipelines and their legacy module versions are unchanged.

## Source and visual ownership

The new program uses `original-music-program-plan/v2-yue2`; schema validation
binds that version to the YuE2 provider and keeps v1 legacy provider semantics.
It exposes musical direction and static-camera visual intent, not generation.
Legacy music generation and public-track reuse refuse a YuE2 program. Conversely,
the shared YuE2 source refuses a route-bound legacy provider selection.

Visual consumers use the existing immutable private candidate and current owner
source approval. They do not manufacture a public music URL/key. Approval and
execution authority are checked before each image attempt and before every H3
native take. Withdrawing approval prevents the next purchase; already observed
image/video costs remain accounted, and these failures cannot trigger a blind
paid retry.

The assembly source verifier was factored into a shared read-only admission.
Visual admission checks the same run/invocation, candidate, arrangement, owner
approval, retained metadata, and execution authority without downloading/folding
the WAV. Assembly retains its private audio-byte hash, native format/frame,
crossfade, and post-work approval checks. No audio has moved to a public bucket.

Creator design, inception certification, and run compilation now share the
conditional Style DNA seed declaration required by the explicit bound planner.
That is a compile-time projection, not a fabricated seed or proof of grounding;
actual frozen input validation and production qualification remain mandatory.

## Evidence

`yue2PipelineSelection.test.ts` checks the selected versions, exact bindings,
budgets, idempotence, and unchanged defaults across five family/playback designs.
`yue2LoopVisuals.test.ts` adds actual routed creator compilation, version/provider
binding, refusal of legacy substitution, withheld approval before visual spend,
and withdrawal before the second image and next H3 take. It verifies the known
first-take costs survive. Its approval/provider boundaries are synthetic.

`yue2Assembly.test.ts` exercises the actual shared approval verifier with mocked
database/storage transports, proves visual admission does not download audio,
and retains real native-float preparation plus existing corruption/revocation
coverage. These are integration tests, not musical approval or new GPU footage.

## Live state and limits

Read-only checks at the start of this stage found production health still on
`722facc4f5aaad004dcd9f96de3be7a29951a520`. The canonical OpenRelay vault key's
fingerprint remained `becf652a4be6`, matching the previously rejected revoked
key; it was not sent again to the provider. A vault update was requested without
asking for the secret in chat.

No GPU/model generation, production deployment, publishing, or thumbnail work
was performed. No live billing savings are claimed. The unchanged release CI
gate, live owner-approved continuation, real channel-output qualification, and
the complete module/backlog requirements remain open.

## Verification

The externally network-isolated 889-file sweep passed 888 files; its only
failure was a source-inspection test searching for the pre-factory `loopClips`
declaration. That test now locates the real factory with the TypeScript parser
and also checks the unchanged legacy export. All existing continuity, source
binding, seam, and cost assertions remain. The corrected test and four related
integration files then passed together (five of five).

No application source changed after that full sweep. Production build and
TypeScript, scoped ESLint, and structural audits passed. Audit baselines were
not changed. Graphify was refreshed after the final test edit.

Broad-sweep log: `/tmp/studio-yue2-loop-readiness-final-20260922.log`.
Build/audit/graph logs use the same `studio-yue2-loop-*-final-20260922.log`
prefix. The five-file rerun completed with zero failures in the tool output.
Thirty thumbnail-named files remained excluded. This is not a complete
production release gate or proof of live GPU execution.
