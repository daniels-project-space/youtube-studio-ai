# Automatic video completion — 16 September 2026

This slice converts per-module “smart” suggestions into one sealed automatic
decision for each real `run-pipeline` execution.

## What is automatic now

- The compiled module order, format-aware title profile, discovery surface,
  audience intent, tone, and opening evidence window are frozen together in
  `automatic-video-plan/v1` before paid blocks run.
- Every automatic run receives the same channel-aware frame strategy. A module
  may consume that receipt, but it may not invent a competing frame heuristic.
- The plan records an input-contract fingerprint for baseline/current
  comparisons (items 01–03), an explicit content-addressed/no-overwrite
  artifact policy (item 09), and resume-safe retry rules.
- The plan is embedded in the existing automatic preflight receipt and passed
  into the engine seed store, so it survives Trigger retries and is visible in
  the run's durable evidence.
- The receipt also carries one fingerprinted `AutomaticControlPolicy` for the
  six selected quality-of-life behaviors: exact-run resume, content-addressed
  reuse, unified preflight, owner-wide deduplication, deterministic conflict
  waves, and undoable bulk actions. New automatic callers cannot quietly fall
  back to independent “smart” heuristics.

## Release boundary

“Fully automatic” means the qualified pipeline runs every declared stage,
resumes accepted work without buying it twice, completes private-first upload
and dispatches the configured scheduled/public intent when its existing
channel policy authorizes it. It does not bypass provider-health, family
qualification, factual/children/music human-review, YouTube OAuth, or the
existing explicit public-publish policy. Those are correctness boundaries, not
“smart” decisions to silently override.

## Selected backlog items

- **01–03:** the plan fingerprint is now emitted on every run, giving the
  frozen module/input identity required for the corpus and baseline harness;
  live paid baseline numbers remain unclaimed until the corpus is expanded.
- **09:** duplicate module producers are rejected while constructing the plan;
  the receipt names content-addressed ownership and explicit revision-only
  supersession.
- **12:** the existing format profile resolver is now sealed into the plan,
  so automatic runs cannot drift back to one universal title band.
- **15:** frame selection is typed as discovery surface, audience intent,
  tone, format, and script evidence instead of a niche-specific string rule.
