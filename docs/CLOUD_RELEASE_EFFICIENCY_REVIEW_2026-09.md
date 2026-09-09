# Cloud release efficiency — inspected, not implemented

This follow-up is part of the existing goal's Trigger/Convex usage reduction. No workflow or deployment authority was changed during the overview batch.

## Current evidence

`.github/workflows/ci.yml` runs its complete quality gate, then deploys both canonical Convex and Trigger for every trusted non-documentation main push. Credential checks and the non-cancelling cloud deployment concurrency group are real. The UI-only reference release `2eedd75` nevertheless created Trigger `20260909.20`; its content hash `0ecd15f2216b668800f75c1f2d0bcc17` exactly matches the preceding accounting release's `20260909.19`. Logs `/tmp/ysa-reference-pages-cloud-deploy.log` and `/tmp/ysa-reported-charge-cloud-deploy.log` prove the duplicate deployment. This establishes unnecessary deployment work, not a measured dollar saving.

The existing code graph contains no YAML workflow nodes, so the known CI file was read directly after the graph lookup. `trigger.config.ts` shows why a naive `src/trigger/**` filter would be unsafe: runtime builds also ship Remotion, assets/fonts, Python scripts and dependencies, and read pinned QA lockfiles. Shared `src/lib` changes may also be runtime changes even when their visible consumer is a page.

## Required design for the next batch

- Keep every current test/audit/assembly/credential gate; optimize deployment work, not quality checks.
- Compare against the **last successfully deployed cloud revision**, not merely the previous Git commit. Otherwise a failed backend deployment followed by a UI-only push could incorrectly skip the still-needed backend update.
- Treat missing, partial or ambiguous deployment evidence as requiring deployment. Convex success followed by Trigger failure must never qualify both runtimes as current.
- Cover transitive source, build config, pinned dependency/QA files, packaged assets and Python helpers in any deterministic runtime input fingerprint. Unknown paths default to deployment; do not assume all scripts, public files or shared libraries are frontend-only.
- Check current main before entering cloud writes, inside the serialized deployment job; an older quality gate can finish after a newer one. Do not cancel a deployment already applying changes.
- Retain separate machine-readable deployed/inherited/held receipts with source revision and runtime identity. A skipped unchanged deployment must cite the earlier successful runtime, not fabricate a new worker version.
- Prove the classifier and real workflow wiring against UI-only, shared-runtime, asset/lockfile, failed-prior-deploy, missing-history, multiple-commit push, manual retry and reordered-job cases. Test classification without purchasing/deploying a dummy worker.

GitHub documents serialization by time of entering the concurrency queue, not guaranteed commit order: [official concurrency guidance](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency). Trigger exposes deployment content identity in its [latest deployment API](https://trigger.dev/docs/management/deployments/get-latest). These are provider contracts; the missing-input/partial-deployment safeguards above are engineering conclusions from this repository's workflow, not claims that a skip mechanism already exists.
