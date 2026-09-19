# Module Ownership Audit - 2026-09-19

## Opt-in arrangement work

The original findings below remain baseline evidence, not a description of
every subsequent revision. `composer_brief@2.0.0-accepted-arrangement` and the
provider-free `music_arrangement_plan` introduce an explicit handoff for the
new YuE evaluation path. The composer authors role, full direction, requested
source-piece duration, sections/energy, form, ending, and playback intent. The
planner validates and seals those choices with owner/channel/run identity and
the source brief fingerprint; it does not supply a second arrangement.

Continuous, unmetered and flat-energy pieces are valid. Four to eight sections
can be review intervals with identical instructions rather than mandatory
musical events. Requested source duration is neither final-video length nor a
claim that the model will produce an exact duration.

The new composer revision declares its paid provider, reserves the configured
model's bounded request cost, and checks execution authority before dispatch.
Actual usage is accounted independently; an unsuccessful paid dispatch requires
reconciliation. The deterministic planner neither purchases nor composes music.

`--arrangement` in the YuE evaluation CLI derives conditioning from the sealed
artifact and forbids an independent style override. The versioned request
retains the full artifact and revalidates the projection before HTTP or cached
reuse. Native output remains unmodified and unqualified, with manual audition
pending. Ending and playback are distinct authored choices; this path does
not enable loop folding, concatenation, or automatic publishing.

The legacy composer, music-program builder, music generator, weekly producers,
and existing channel definitions are not switched to this new handoff. The
old independent-arrangement behavior remains a comparison baseline. Production
provider integration and per-consumer playback qualification are still needed:
current video renderers loop or truncate beds and cannot claim preservation of
a finite natural ending. Unsupported combinations must be refused before
purchase when this handoff is connected to those consumers.

The structural `audit-inert-produces` count increases from 68 to 69 for
`music_arrangement_plan.acceptedMusicArrangement`: it is persisted terminal
evaluation evidence, consumed through the explicit CLI artifact-file handoff,
not a downstream production block. This limitation is intentionally retained
in the baseline; no synthetic production consumer or audit exemption is added.
The later opt-in external-score consumer also reads this arrangement to check
identity and playback, but does not generate from it or qualify the audio.
The static default-manifest audit still reports the same count.

### Local verification checkpoint

- The complete 841-file direct readiness run passed 839 files and identified
  missing planner entries in the browser-safe registry and catalog spine. Both
  entries were added with evaluation-only descriptions; both failing suites
  then passed individually (92 executable cards, 12 family graphs). The full
  suite was not repeated after these two catalog-data additions.
- The accepted-arrangement, composer/planner, paid-dispatch and YuE client
  checks passed, including 51 client checks and a real Python HTTP/TypeScript
  CLI integration with exactly six fake inference calls. No real model ran.
- Production build and TypeScript passed. Scoped ESLint has no errors and two
  pre-existing unused-variable warnings in the Mastra agent file.
- Structural audits passed after the explicitly documented terminal-artifact
  baseline change above. Graphify was refreshed locally and remains ignored.
- Existing channels were not mutated. The development branch remains held
  from production; GPU qualification, listening review, production consumers
  and complete legacy execution isolation are still open.

## Scope and evidence

### External-score consumer work

The opt-in `motion_comic@2.0.0-shared-score` revision separates score supply
from comic rendering. It requires the shared music producer's capability and
`musicKey`, with explicit playback, gain and final-master loudness settings.
Its selected source is owner-scoped and content-addressed locally; it must not
fall back to the renderer's historical `music.mp3` cache or internal Suno job.
Before paid planning, a create-only run binding pins the source digest and mix
identity. Later attempts must match that binding even when the storage key is
unchanged. The renderer's returned consumption evidence must agree before the
block can persist a successful master. These checks do not certify the music.
The default comic version and automatic designer remain legacy behavior.

The integrated runner also exposed an existing producer-contract mismatch:
Mureka/Suno return no MiniMax runtime/native receipt, but the legacy music ABI
requires both; its raw reuse shortcut additionally omits the music program.
The paired `music@2.0.0-provider-outputs` revision declares provider-specific
receipt outputs while continuing to require them for MiniMax. It does not
fabricate empty receipts or change provider generation. Raw `reuseMusicKey`
cannot prove the original provider or review state and is refused by this new
revision; the existing verified prepared-music path remains distinct. Neither
legacy behavior nor a release gate is changed to make a fixture pass.
The new comic revision also declares its planner's existing `persona` and
`criticDoctrine` reads. The legacy runner still refuses the undeclared persona
read; a direct legacy-control fixture separately verifies its original scoring
behavior without claiming that its old runner contract passes.

This is a consumer integration, not YuE production activation. The YuE runtime
still lacks attributable charge evidence and a durable cross-worker submission
and approval path in Studio. Its current evaluation output remains unqualified;
the MiniMax-specific audition checkpoint is not reused as a YuE approval.

Playback is an explicit decision: `repeat` authorizes repeating the supplied
score, while `once` must preserve its finite ending rather than silently loop
or truncate it. Source duration is measured from bounded decoded audio rather
than trusted container duration. Actual comic duration is known only after rendering; a source
that exceeds that duration must fail the final mix. Early byte/audio validation
does not imply that every eventual duration conflict can be known before paid
art or narration exists. Source identity proves consumption, not musical
quality, adherence to a composer brief, or permission to publish.

Batch verification: the full readiness run passed 845 of 846 direct tests.
The remaining storyboard structural test expected the old literal block
declaration; its marker was updated to the shared factory, and the complete
test then passed with its planning/render separation and paid-call assertions
unchanged. This is a full-run result plus a focused correction, not a claim
that a second full 846-test run occurred. Focused producer/consumer handoff,
version-resolution, source-binding, cost reconciliation and actual FFmpeg
tests passed. Provider, artwork and voice calls in the integrated handoff test
are fixtures; decoded audio, finite endings and video packet preservation
are independently tested using real FFmpeg. No GPU music quality was certified.
Scoped lint and the audit gate passed without changing audit baselines.
The first concurrent build ended with signal exit 143 without a diagnostic;
a standalone build subsequently passed compilation, TypeScript and all 69
static pages. Its external-FFmpeg tracing warning was addressed with the
existing repository annotation and the real FFmpeg test passed again. The
final build then passed compilation, TypeScript and all 69 static pages
without those tracing warnings.

Future automatic pipeline composition only. Existing channels, pipelines,
schedules, outputs, and baseline evidence must remain untouched. Graphify's
existing graph was queried first, then implementation callers and handoff tests
were inspected. Findings describe the working tree, including the concurrent
music-direction patch, not only the committed baseline.

Two pure, provider-free reproductions ran successfully and observed the failures
below. The comic finding is source-traced, not a rendered/provider reproduction.
No channel mutations, provider calls, deployments, or runtime edits were made.
Before adding this document, `.locks` was inspected and contained no markers.

## 1. Accepted composer mix directives disappear at assembly

- Producer: [crewBlocks.ts:487](/home/ubuntu/youtube-studio-ai/src/trigger/blocks/crewBlocks.ts:487)
  emits `musicBrief.directives` with gain, master loudness, and voice effect.
- Broken handoff: [cutover.ts:116](/home/ubuntu/youtube-studio-ai/src/lib/assembly/cutover.ts:116)
  maps the production store to `PlanInput` without setting `composer`.
  `assembleViaEdl` adds editor directives, but not composer directives.
- The pure [planner:650](/home/ubuntu/youtube-studio-ai/src/lib/assembly/planTimeline.ts:650)
  honors `input.composer`; the direct [assembler:3852](/home/ubuntu/youtube-studio-ai/src/trigger/blocks/narratedBlocks.ts:3852)
  instead uses block params/defaults. Its [contract:693](/home/ubuntu/youtube-studio-ai/src/engine/moduleContracts.ts:693)
  does not declare consumption of `musicBrief`.

**Observed failure:** accepted `{bodyMusicVol: 0.25, targetLufs: -16,
voiceFx: "warm"}` becomes `{bodyMusicVol: 0.1026, targetLufs: -14,
voiceFx: undefined}` through the real adapter and pure planner.

Existing [composer tests](/home/ubuntu/youtube-studio-ai/src/lib/crew/__tests__/composer.test.ts:33)
inject directives directly into the planner, so their passing wiring assertions
do not exercise this adapter. Whiteboard separately hardcodes gain `0.10` in
[its mux:732](/home/ubuntu/youtube-studio-ai/src/trigger/blocks/whiteboardScribeBlocks.ts:732).

**Benefit:** composer-equipped narrated pipelines, notably `narrated_stock` and
`cinematic`. Whiteboard needs separate integration/proof; this reproduction
does not qualify every family or justify enabling EDL for unsupported routes.

**Precedence follow-up:** simply forwarding the dropped object is not a safe
fix. The current planner puts composer directives above explicit assembly
parameters. An opted-in replacement must resolve each field as explicit
assembly choice, then validated composer directive, then the existing default.
Explicit zero gain and an explicitly chosen default loudness remain choices,
not missing values. Only `bodyMusicVol` and final-master `targetLufs` belong in
this assembly handoff. Composer `voiceFx` must not cause a second voice-effect
pass: narration currently owns its own explicit-param/composer-audio fallback.
LLM `duckDb`/`bedLufs`, music-track DNA loudness and Studio prose are different
contracts, not interchangeable sources for these final-mix numbers. The
production no-profile adapter also ignores `musicDuckProfile`; activating that
control needs explicit precedence tests rather than an accidental side effect.

## 2. Generation imposes an independent arrangement over accepted direction

[roleSections:199](/home/ubuntu/youtube-studio-ai/src/engine/channelMusicProgram.ts:199)
chooses arrangement from role and duration only. The call at line 440 does not
pass the accepted composer direction. [musicBlocks.ts:352](/home/ubuntu/youtube-studio-ai/src/trigger/blocks/musicBlocks.ts:352)
appends that arrangement for Suno/Mureka; MiniMax receives it in the structured
caption.

**Observed failure:** a 300-second `music_loop` program requesting "Flat energy
throughout. No drums, no groove, no rebuild, no lift." still contains mandatory
grounded groove, rebuild, and late-lift instructions; section energies span
`0.30` to `0.76`. Preserving the original sentence does not resolve the conflict.

This is duplicated creative planning, not legitimate provider-specific tag or
caption formatting. The current [sharedMusicDirection tests](/home/ubuntu/youtube-studio-ai/src/trigger/__tests__/sharedMusicDirection.test.ts)
cover direction preservation across providers and weekly preparation, but not
contradictory downstream arrangement. [channelMusicProgram tests](/home/ubuntu/youtube-studio-ai/src/engine/__tests__/channelMusicProgram.test.ts)
cover role defaults, section structure, and receipts.

**Benefit:** shared-music consumers across roles. The exact failure was reproduced
for `music_loop`; narrated, meditation, and quiz/short roles require their own
distinct intent fixtures. A future fix should make arrangement an explicit
accepted planning artifact, with generation adapting its representation rather
than inferring a new creative plan from family defaults.

## 3. Comic renderer owns hidden score generation

The [designer:748](/home/ubuntu/youtube-studio-ai/src/engine/designerCore.ts:748)
removes shared music/composer stages for motion-comic. The
[renderer brief:603](/home/ubuntu/youtube-studio-ai/src/trigger/blocks/motionComicBlocks.ts:603)
passes neither an accepted music direction nor shared music asset. The library
then [generates its own Suno score:1816](/home/ubuntu/youtube-studio-ai/src/lib/motionComic.ts:1816)
when its music cache is absent, using an orchestral, strings/piano, building
default. Music failure is caught and rendering continues without it.

The [motion_comic contract:1458](/home/ubuntu/youtube-studio-ai/src/engine/moduleContracts.ts:1458)
includes music in its cost ceiling but exposes neither a music-generation
capability nor a shared music handoff. This is an ownership/composability gap,
**not unaccounted spend or evidence of duplicate music purchases**. The compiler
deliberately avoids an unused upstream track, but leaves scoring inside rendering.

**Executable failing-case idea, not yet run:** compile a new comic test pipeline
with an explicit accepted score, invoke the renderer with art/voice/storage and
provider boundaries stubbed, and require consumption of that exact score with
zero nested music calls. The current renderer has no shared-score input path;
with no music cache it calls Suno. Existing native-story handoff tests do not
establish score ownership.

**Benefit:** `comic` directly. Do not extend this finding to `loreshort`, whose
narration-only design intentionally has no score.

## Executable isolation is a prerequisite

Unchanged records do not preserve execution when their shared code changes.

- [PipelineEntry:156](/home/ubuntu/youtube-studio-ai/src/engine/types.ts:156)
  has only `block` and `params`, with no executable revision selector.
- The [registry:15](/home/ubuntu/youtube-studio-ai/src/engine/registry.ts:15)
  permits one implementation per ID and rejects duplicate IDs regardless of
  manifest version. [Validation:74](/home/ubuntu/youtube-studio-ai/src/engine/validate.ts:74)
  resolves by ID; [compilation:810](/home/ubuntu/youtube-studio-ai/src/engine/pipelineCompiler.ts:810)
  records the version of the implementation already resolved.
- [Manifest versions:143](/home/ubuntu/youtube-studio-ai/src/engine/moduleManifest.ts:143),
  artifact schemas, compilation fingerprints, and producer-version checks provide
  contract/provenance evidence. They do not retain or dispatch old implementations.
  The [stale-producer regression:126](/home/ubuntu/youtube-studio-ai/src/engine/__tests__/moduleHandoffBinding.test.ts:126)
  proves rejection, not executable isolation.

**Isolation failing-case specification:** register old/new implementations under
one logical ID with different manifest versions; require an unchanged legacy
pipeline to execute old and an opted-in pipeline to execute new. Today the second
registration fails and pipeline entries cannot select either version. Distinct
implementation IDs can coexist, but routing and frozen transitive helpers must
still be explicit. Merely bumping a manifest version or wrapping changed helpers
does not preserve baseline behavior. No deployment-level isolation was verified.

## Recommendation and focused regressions

Before enabling replacements, establish and test explicit old/new execution
isolation, including affected shared helpers. Preserve legacy bindings and
retained evidence; opt only new test pipelines into replacements. Unknown
implementation revisions must fail closed. Relevant engine surfaces are
`types.ts`, `registry.ts`, `validate.ts`, compiler records, and their tests; a
distinct-ID approach can reuse the current registry but still needs explicit
composition bindings and isolation coverage.

Then fix finding 1 first: connect the accepted composer directive artifact to
both production assembly paths and declare its consumption. Define precedence
explicitly; retain no-directive fallback in the legacy implementation. Target
`cutover.ts`, `narratedBlocks.ts`, and `moduleContracts.ts`, with an adapter
regression in [cutover.test.ts](/home/ubuntu/youtube-studio-ai/src/lib/assembly/__tests__/cutover.test.ts)
and a stubbed real-block test asserting actual mix arguments. Do not re-resolve
a competing mix plan inside assembly. Whiteboard is a separately proven consumer.

Generic handoff tests already cover missing payloads, references, stale versions,
and producer binding. Add semantic real-caller tests, not duplicates of those
checks. No separate generalized composition-merge defect was established.

## Reproduce the two observed failures without providers

Run from `/home/ubuntu/youtube-studio-ai`; this uses local modules, disables the
tsx transform cache, and performs no rendering, persistence, or provider calls.
The assertions intentionally assert the observed defects, not desired behavior.

```sh
TSX_DISABLE_CACHE=1 node --import tsx <<'NODE'
const assert = require('node:assert/strict');
const { buildPlanInput } = require('./src/lib/assembly/cutover.ts');
const { planTimeline, ASSEMBLE_DEFAULTS } = require('./src/lib/assembly/planTimeline.ts');
const { createChannelMusicProgram } = require('./src/engine/channelMusicProgram.ts');
const directives = { bodyMusicVol: 0.25, targetLufs: -16, voiceFx: 'warm' };
const input = buildPlanInput({
  footageClips: ['audit-f.mp4'], narrationLocalPath: 'audit-n.wav',
  narrationDurationSec: 120, musicKey: 'audit-m.mp3',
  musicBrief: { directives, configVersion: 'composer@1.0.0' },
}, {});
const timeline = planTimeline(input, ASSEMBLE_DEFAULTS);
assert.equal(input.composer, undefined);
assert.equal(timeline.audio.duck.bodyVol, 0.1026);
assert.equal(timeline.audio.targetLufs, -14);
assert.equal(timeline.audio.voiceFx, undefined);
const program = createChannelMusicProgram({
  channelId: 'audit-only', channelIdentityFingerprint: 'a'.repeat(64),
  family: 'music_loop', contentLaneKey: 'music_loop', topic: 'Stillness',
  providerPreference: 'suno', durationSec: 300, genre: 'beatless ambient',
  instrumentation: ['sustained organ', 'soft air', 'distant bell'],
  composerDirection: 'Flat energy throughout. No drums, no groove, no rebuild, no lift.',
});
assert.match(program.generation.sections.map(s => s.instruction).join(' '), /late lift/i);
assert.equal(Math.min(...program.generation.sections.map(s => s.energy)), 0.3);
assert.equal(Math.max(...program.generation.sections.map(s => s.energy)), 0.76);
console.log('Observed both ownership failures; no providers called.');
NODE
```
