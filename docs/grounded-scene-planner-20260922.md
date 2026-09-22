# Grounded scene planner revision

Explicit version: `scene_planner@2.0.0-grounded-deterministic`.
The default planner and all existing channel pipeline records remain unchanged.
This is contract-level progress toward the module-first MVP, not production or
creative-quality qualification.

## Defects reproduced

The legacy planner calls `Math.random()` for signature-scene selection. Repeating
identical frozen inputs therefore changes its scene. That branch also includes
only the selected setting, dropping the recurring subject that Style DNA defines
as the brand's recognizable subject across its signature scenes.

The regression reproduces both defects against the retained legacy planner. It
also executes the new version through the actual registry, pipeline validator,
and runner. That exposed an additional contract defect: non-route episodes omit
`musicProgramMotionIntent`, but the legacy manifest declares it mandatory. The
new version makes that route-only output optional; it does not fabricate an
intent, add a provider call, or weaken required scene outputs.

## Changed behavior

- Signature-scene choice is derived from a stable hash of the topic, recurring
  subject, and frozen scene choices. Identical inputs yield identical output;
  different topics can select different settings.
- The recurring subject survives every synthesized scene, alongside its
  composition, color grade, motifs, forbidden elements, and selected motion.
- Only the visual projection of Style DNA is validated and passed to synthesis.
  Music, narration, SEO, and other module-owned fields are not consumed.
- Required identity, scene entries, duration, and selected authored library
  entries are validated before returning a plan. Invalid inputs do not reach a
  paid provider through this module.
- Authored exact-topic library entries stay verbatim. They are not rewritten
  into synthesized scenes; their quality still requires downstream review.
- The original block is exposed through a strategy factory, and the central
  registry registers the corrected strategy only under its explicit version.
  Selecting it requires the frozen Style DNA artifact. Default-version lookup
  and legacy output remain unchanged.

The test exercises three different recurring subjects, repeated inputs with
`Math.random` forbidden, scene/motion pairing, immutable inputs, invalid values,
authored-library parity, legacy parity, and a real zero-cost runner execution.
No provider transport or paid generation is used.

## Still open

Stable hashing is not proof of channel-level variety, reuse-policy compliance,
or artistic quality. This version has not generated or qualified new channel
footage and is not automatically selected for legacy channels.

The existing route-owned music-program path passes its setting as a hint which
the grounded DNA path can override. That setting-authority conflict remains
open, as does alignment of the downstream visual critic with an explicitly
selected signature setting. Those contracts require a bound visual-plan
handoff, not silent overwriting of frozen identity or music decisions. This
revision does not claim to resolve either conflict.

The shared YuE2 source, musical approval, approved-source continuation, exact
production deployment, and complete module/backlog requirements remain separate
release evidence. No provider, publishing, thumbnail, or channel record was
changed by this revision.

## Verification

After the final source edit, all 887 selected readiness files passed in an
externally network-isolated run. Thirty thumbnail-named files were excluded.
The production build, TypeScript, scoped ESLint, and diff whitespace checks
passed. Structural audits reported no regression; their committed baseline was
not changed. Graphify was updated after the source edit.

Local logs: `/tmp/studio-grounded-scene-readiness-20260922.log`,
`/tmp/studio-grounded-scene-build-final-20260922.log`,
`/tmp/studio-grounded-scene-audit-20260922.log`, and
`/tmp/studio-grounded-scene-graph-20260922.log`.

This remains a partial release gate, with no production deployment or real
creative-output approval implied.

Follow-up: the separate version pair documented in
`bound-loop-visual-plan-20260922.md` binds setting authority and the selected
identity into keyframe review. This original opt-in revision is unchanged.
