# Runtime deployment efficiency — investigation, not a skip gate

The cloud receipts from consecutive UI releases record the same Trigger content hash, `101fa3a5b4b7ad6781cca1df216d69e9`, while CI deploys both canonical Convex and Trigger after every main change. This identifies an optimization opportunity, **not** proof that a generic hash comparison can safely skip either deployment. No workflow or deployment command was changed during this investigation.

## Verified constraints

- Current CI serializes cloud releases and retains full quality checks. A replacement must reconcile against the last successful deployment, not merely the previous Git commit; failed, cancelled, skipped and reordered releases must not suppress required changes. [GitHub's workflow-run API](https://docs.github.com/en/rest/actions/workflow-runs) exposes completion, attempts and exact head revisions for receipt discovery.
- [Current Trigger CLI documentation](https://trigger.dev/docs/cli-deploy-commands) describes `--external-id` deduplication. **The pinned, actually installed 4.5.9 CLI does not implement that flag.** Do not copy the latest syntax into this project or silently upgrade its runtime to obtain it.
- Actual 4.5.9 `commands/deploy.js` checks `nativeBuildServer` and calls `handleNativeBuildServerDeploy` **before** the ordinary `dryRun` branch. The native handler creates/uploads an artifact and initializes a deployment; it does not inspect `dryRun`. Therefore `npm run trigger:deploy -- --dry-run` is not a safe diagnostic here: the package script already includes `--native-build-server`. **That combination was not executed.**
- The ordinary non-native dry-run builds locally, but first accesses project/environment information and runs build/skill extensions. It is not an unauthenticated, guaranteed-side-effect-free source hash operation.
- Actual `build/bundle.js` computes `contentHash` from esbuild output hashes. `buildWorker.js` adds external dependencies, image instructions and additional files through later build-extension completion. Our configuration adds pinned Python/model/image layers. Therefore the observed JS hash alone is insufficient evidence that the complete deployable runtime is identical. [The deployment API](https://trigger.dev/docs/management/deployments/get-latest) exposing `contentHash` does not change that scope.

Source inspected: `/root/.npm/_npx/216caafab2f9ed6d/node_modules/trigger.dev/` (`commands/deploy.js`, `build/bundle.js`, `build/buildWorker.js`, `utilities/buildManifest.js`), the current `trigger.config.ts`, and `.github/workflows/ci.yml`. These local pinned sources override assumptions from newer documentation.

## Remaining work

Qualify a deterministic complete runtime identity, including extension files/layers, dependency locks, target/environment and deploy-tool identity; prove safe behavior for changed dependencies, configuration, missing receipts, failed prior releases and concurrent promotion. Keep a deliberate full-redeploy path. Convex needs its own verified identity/receipt rather than inheriting the Trigger decision. Only then wire an unchanged-runtime check into CI and measure actual deployment/call/time savings. No cost saving or completed efficiency requirement is claimed from this research alone.
