# MVP delivery priority

## Owner decision

On 19 September 2026 the owner made the working MVP the top priority for the
whole product. Fix shared/core module blockers before broad UI redesign or
isolated format refinements. This changes delivery order, not the quality bar
or the scope of the 163-item additive backlog. Do not declare the whole goal
complete when only the MVP passes.

Latest owner decision: leave every current channel and pipeline as a legacy
baseline. Do not migrate, re-template, repair, or replace those channel records
as this work's objective. Focus effort on reusable modules for automatic future
pipeline creation. Each module must fulfill its specific responsibility, accept
explicit upstream contracts, and avoid taking over or contradicting another
module's work. Once the module system is ready, create new pipelines from the
same requirements and compare their retained results with the legacy baseline.

The latest music requirement is a separate YuE 2 runtime on an OpenRelay RTX
3090, shared by Lo-Fi, background scores, sleep and meditation. Lo-Fi supplies
its sound requirements to the shared music module rather than owning music
generation. The owner explicitly confirmed personal creator use. Company SaaS
licensing is not authorized by that confirmation.

## Live infrastructure correction, 21 September

The historical credential rejection below is superseded. Canonical
`openrelay/OPENRELAY_API_KEY` works, Studio's stale vault copy was repaired, and
Studio's retained provider disks are populated. Dedicated H3 and YuE2 images,
worktrees and separate local volumes have been built. The repeatable YuE2 build
has verified its real retained weights offline; this is not inference proof.
Studio now has its own verified OpenRelay SSH identity, registered but attached
to no VM. Exact build commands, identity and evidence locations are in
`infra/studio-render/README.md`. Do not reuse Lito's SSH identity or runtime.

The next live YuE2 gate remains an explicitly authorized bounded GPU allocation,
private worker deployment, actual native generation and musical audition. The
pending up-to-$1 compute request is not approval, and new persistent storage
charges still need checking. Do not substitute more build checks for that live
gate or mark the shared production music integration complete.

## MVP acceptance

- Owner clarification: every channel is different. One successful video or
  family contract does not qualify the whole Studio or another channel.
  Shared modules must honor each channel's own executable contract, audience,
  format, voice, pacing, visual grammar, music needs and quality criteria.
  Evidence must name the exact channel, route and retained output; channels
  without current evidence remain explicitly unverified.
- New test pipelines start from distinct real briefs and reach the architect,
  their declared executable modules,
  script, narration, visuals, shared music where required, assembly, captions,
  thumbnail and metadata without manual creative substitution.
- The exact retained master passes independent quality checks and complete
  visual/audio inspection; a successful compile is not output qualification.
- Module tests establish responsibility and handoff boundaries as well as
  isolated behavior. Composition tests vary the brief and module arrangement;
  a module must not silently replace another module's accepted decisions or
  smuggle in undeclared planning/generation/publishing work.
- Legacy channel definitions, pipelines, schedules and retained outputs remain
  untouched. Before/after comparisons bind the same input requirements, exact
  pipeline/module revisions, quality criteria and retained output evidence.
- Unchanged channel records alone do not freeze legacy execution: shared code
  changes can still alter their behavior. Before enabling replacement modules,
  establish an explicit version boundary so legacy pipelines retain their known
  implementation and new test pipelines opt into the updated module system.
  Preserve baseline revision/configuration and available retained artifacts;
  do not regenerate or overwrite legacy evidence to manufacture a comparison.
  This isolation is an acceptance requirement, not a claim that the current
  runtime already provides it.
- The user can inspect actual progress, failure reasons, artifacts and the
  final retained video. Essential controls work against real state.
- Retry/resume preserves accepted artifacts and cumulative cost. Stale workers
  cannot continue paid requests. Ambiguous submissions do not authorize a
  second purchase.
- Scheduling and private YouTube delivery use the correct owner/channel,
  existing authorization and publication gates. Public publishing is not
  silently enabled to demonstrate the MVP.
- Accepted changes pass focused and release checks, are committed/pushed, and
  are verified on the exact Vercel alias and canonical Convex/Trigger services.

## Frozen local checkpoint, 21 September

Current-state verification at Studio source
`4f58b788a04c53039c0288c4bd6ca247a1b89eca`:

- Remote main and the exact production `/api/health` alias still report
  `722facc4f5aaad004dcd9f96de3be7a29951a520`. The development branch has 229
  changed files versus that main revision. Pushing it has not released it.
- All 849 selected readiness files pass with external networking disabled and
  30 thumbnail-named files excluded. Source remained unchanged throughout the
  run. This is a frozen partial gate, not the complete production gate.
- The canonical Next.js 16.3.4 Turbopack production build passes in a separate
  detached checkout with an empty credential environment and only public
  configuration. Its local health endpoint returns the exact tested SHA.
  A preliminary network-isolated Webpack build failed on Google font downloads
  and an existing global-only CSS-module selector; it is not claimed passing.
  The canonical build was permitted public font downloads, not provider tests.
- The existing hermetic assembly smoke test produces a real 1920x1080 H.264/AAC
  master lasting 31.021995 seconds, 17,576,594 bytes, with four rendered segments,
  no receipt warnings and no R2/provider access. Sixteen sampled frames across
  the duration show the ordered synthetic clips, motion and intended fade-out.
  This proves local assembly, not a real channel's visual/audio quality.
- Isolated music runtime remains at `813dcb91da839820b0c0b6bbbf89f65bcd29a67d`.
  Its current manifest still records RTX 3090, musical quality, exact duration
  and instrumental-only behavior as unqualified, with production approval false.
  No real YuE output qualification is established by the synthetic fixtures.

Retained local evidence: `/tmp/studio-frozen-readiness-4f58b788.log`,
`/tmp/studio-canonical-build-4f58b788.log`,
`/tmp/studio-assembly-4f58b788.log`,
`/tmp/assembly-smoke-AuqhE1/bk_smoke_2_loudnorm.mp4`, and
`/tmp/studio-assembly-4f58b788-frames.png`.
Master SHA-256:
`de7b07e460ee9c5e3fd4f5f7ad57e1b78a03aaaf7543ea9c21d2f06b1399d15c`.

The next release requires review of the dependency-ordered rollout, including
Convex before new worker callers and prepared-job drain/reconciliation controls.
Deployment authorization and a total authorized GPU evaluation spend cap have
been requested. The previously rejected OpenRelay credential was not retried.
The music continuation remains an implementation gap: the existing production
audition checkpoint is MiniMax-specific (32 kHz PCM16), whereas retained YuE
evidence is 48 kHz float. Do not relabel, resample or autoapprove it to pass that
contract. Qualify actual YuE output, then implement its explicit approval,
mastering and shared-module continuation while preserving legacy execution.
The MVP and full additive backlog remain incomplete.

## Initial evidence, 19 September

- Main and production health both report
  `cca5eb4fe26468b5a03411ceec6c249cf99596d2`. Health is an HTTP/service check only.
- The live automatic-family endpoint admits eight creator contracts. It
  explicitly does not qualify their live provider execution.
- Shared module tests pass 615 required handoff edges with removal/reorder
  mutations, plus whole-graph mutations across 12 families.
- The real QuizYear designer/validator/compiler dry run passes with 15 modules,
  23 capabilities and a $1.676 reservation inside its $3 envelope. It performs
  no generation and is not a finished-video proof.
- An authenticated, read-only query of 30 recent `owner_daniel` runs on
  `astute-camel-689` returned only `legacy_inferred` pipelines, with no current
  release-ready evidence. Do not use their historical `ok` statuses as MVP
  proof. This bounded query is not a claim about every owner or historical run.
- Fresh music-loop, lore and cinematic admission requires the qualified H3
  on-demand route; weekly OpenRelay fallback is a distinct contract. Do not
  bypass this gate or infer missing provider availability from local env alone.
- Read-only OpenRelay VM checks returned HTTP 401 with both the YouTube-service
  credential and the canonical `openrelay/OPENRELAY_API_KEY`. No VM was started,
  stopped, created or deleted. Owner was asked to renew the shared-vault key;
  local music/runtime work continues while live GPU qualification is held.

## First shared execution repair

The shared `music` block lived inside `lofiBlocks.ts` and reused the generic
Topic Select ownership guard. A valid certified QuizYear route therefore
compiled but failed in music before any provider call: its legitimate
`quiz_topic_plan` owner does not declare `topic_select`.

Music now lives in `musicBlocks.ts`, registered independently with the same
block id and artifact ABI. Its shared route parsing retains schema validation
without imposing the topic planner's ownership rule. The topic planner keeps
its strict ownership check. Both certified geography and sports quiz routes
pass real music-block retained-track execution with zero network calls;
malformed routes still fail before reuse. Music-loop sealed-program checks,
prepared receipts, audition gates and provider choices remain unchanged.

The rejecting regression was observed before the repair. All 819 direct
readiness tests pass afterward, including both new shared-music suites. The
production build (including TypeScript), 31.02-second real hermetic assembly,
29 Python worker tests, structural audits and defect-proof checks pass. Full
lint reports zero errors and 31 existing warnings; the production dependency
audit has no high/critical findings and reports four moderate findings. The
code graph was updated. Commit `5f147442` passed cloud CI run `35467414925`.
The exact Vercel production alias reports that revision, canonical Convex
`astute-camel-689` was deployed, and Trigger production version `20260919.25`
was deployed successfully. This proves deployment, not finished-video quality.

The isolated `/home/ubuntu/youtube-studio-music-runtime` evaluation runner has
30 passing CPU tests with explicitly fake heavy inference APIs, a built Python
package, pinned official source/model/VAE identities, immutable artifact
receipts, and personal-creator scope. This is not live GPU or audio-quality
evidence. It is not yet connected as Studio's production provider.

## Recovered execution safety

The skipped recovery commit contained useful pre-purchase execution ownership
checks. These are selectively restored against the newer runtime: a service-only
Convex query checks the exact owner/channel/run/worker generation using server
time. Every new metadata provider dispatch obtains a fresh, nonmemoized check;
already-paid cached responses remain reusable. A stale or denied check is
nonretryable, is not classified as an ambiguous paid request, and cannot be
swallowed by the optional comment or package fallback. This is admission before
dispatch, not atomic cancellation of a provider request already in flight.

Three focused suites pass through the real runner, metadata block, provider
client and authenticated handler with intercepted network calls. They cover
revocation between all four metadata purchases, generator/judge retries,
expiry, foreign identities, grant expiry in transit, cache reuse and existing
ambiguous-outcome no-replay behavior. No paid provider request was made.
All 822 direct readiness tests pass for this batch, along with the production
build including TypeScript, focused lint, structural audits and defect-proof
checks. The code graph was updated. Commit `722facc4` passed cloud CI run
`35468419619`; the exact Vercel alias reports that revision, canonical Convex
`astute-camel-689` deployed successfully, and Trigger production version
`20260919.26` deployed successfully. No channel records or schedules changed.

An existing no-key metadata fallback emits a null title-decision receipt that
the runner refuses. The fence does not change this behavior or bypass the
receipt contract. Live metadata must use the approved configured provider.

## Work order

### Historical development batch, not activated

The shared music direction patch preserves explicit source/composer/Studio
direction in both runtime and weekly preparation; independently executed
`sharedMusicDirection` and `channelMusicProgram` tests pass. It does not resolve
the conflicting default arrangement identified by the
[module ownership audit](MODULE_OWNERSHIP_AUDIT_2026-09-19.md). That audit also
reproduces dropped composer mix directives and traces hidden comic score
generation. The registry records versions but does not select executable
implementations by version. Hold activation of behavior-changing replacements
until the explicit legacy/new execution boundary is implemented and tested.

The isolated YuE HTTP worker passes 63 CPU tests, and the Studio evaluation
client passes 46 focused checks. The real cross-language integration command
below passes through the Python HTTP worker, actual Studio CLI, immutable
receipts and native WAV inspection with ffprobe. It verifies same-ID GET
recovery, cache reuse and rejection of altered local audio, with exactly one
explicitly fake inference call. It is not RTX 3090, musical-quality,
instrumental-only or production-provider qualification. No live channel,
schedule or provider selection was changed.

All 824 direct readiness tests, the production build including TypeScript,
standalone typecheck and focused ESLint pass for this development batch. The
test-only deferred loader was subsequently made ESLint-compliant and its focused
behavior check rerun successfully. No assembly implementation changed; this is
not a new finished-video qualification or a production deployment. Runtime
commit `ec002b3` is pushed to its separate repository. Its 63 CPU tests and
Ruff 0.12.12 default rules (`E4,E7,E9,F`) pass; Ruff 0.16.8's broader defaults
report style/broad-exception findings and are not claimed clean.

```sh
YUE2_TEST_RUNTIME=/home/ubuntu/youtube-studio-music-runtime npx tsx scripts/test-yue2-runtime-integration.ts
```

### Ordered delivery

The [explicit module selection development batch](MODULE_VERSION_ISOLATION_2026-09-19.md)
adds exact version dispatch, preservation through pipeline transformations and
version-bound recovery checks. It is not yet complete legacy/helper/deployment
isolation and does not authorize production activation of replacement modules.
All 831 direct readiness tests pass, together with the production build including
TypeScript, focused ESLint, structural audits and a 31.02-second real hermetic
assembly smoke test. Real remote-worker fixture tests verify selected dispatch,
missing-version/fingerprint refusal and unchanged historical selection. Weekly
tasks now reject explicit pins before reuse/generation until their independent
implementations are revision-aware and qualified. The code graph was refreshed;
this batch remains on the development branch, with production main at `722facc4`.

1. Preserve and reconcile the broken session's work. Aggregate `4da39dec` is
   protected by branch `recovery/studio-pre-rebase-4da39dec`. Both main and
   `/tmp/ysa-next-bcb` were clean at the starting revision. The aggregate is
   not all duplicate: selectively port useful shared safety fixes, without
   restoring old implementations over newer safeguards.
2. Recover pre-purchase execution ownership checks and separate shared music
   ownership while preserving the existing artifact/receipt contracts.
3. Qualify the isolated YuE 2 runtime and connect it to the real shared music
   caller, preparation, recovery and admission paths. Do not advertise the
   switch as complete before real instrumental output and listening evidence.
4. Harden module responsibility boundaries and cross-module handoffs. Test
   automatically composed new pipelines across distinct briefs, then compare
   their real retained outputs against the untouched legacy baseline. Fix
   shared root causes rather than performing a channel-by-channel repair or
   migration sweep. Keep exact failure and before/after evidence; a family
   label or one successful output does not qualify unrelated compositions.
5. Verify the operating workflow and release. Then expand family qualification
   and return to the remaining backlog in impact order.

## Deliberately not MVP prerequisites

The full five-pass UI overhaul, every specialist page refinement, new chess or
worked-example capabilities, full-page comic experiments, and fleet-wide
efficiency benchmarks remain requested follow-up work. None should delay a
working core release unless it exposes a shared correctness or safety blocker.
Existing-channel contract migration is also deferred by the latest owner
instruction. Missing legacy brief/route fields are baseline facts, not authority
to rewrite the channels or bypass fresh-run admission.

## YuE 2 qualification boundary

The official YuE2-3B documentation targets one job at a time on a BF16-capable
24 GB GPU with at least 24 GB available host RAM, using native 48 kHz stereo
output. Keep full planning and the recommended VAE, not a lower-quality
substitute. Actual RTX 3090 speed, OpenRelay execution, instrumental-only
reliability, natural looping and owner listening approval remain unverified.

Sources: https://huggingface.co/m-a-p/YuE2-3B and
https://github.com/multimodal-art-projection/YuE/blob/bd90e4ccae671d869b3ecaca6d7e893927d29442/MODEL_LICENSE
