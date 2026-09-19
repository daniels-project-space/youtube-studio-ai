# Runtime deployment fingerprints — local foundation, not a reuse gate

`scripts/cloud-runtime-fingerprint.mjs` now computes separate conservative Convex and Trigger input fingerprints. It does **not** change CI, deploy, query either provider, read Git, persist deployment receipts, or authorize a skipped deployment. Every result says `reuseAuthorized: false`. A provider with an incomplete inventory returns `status: blocked` and `fingerprint: null`.

## Closed input inventory

The policy binds SHA-256 to provider/target, policy version, the fingerprint implementation's bytes, tool/runtime declarations and actual Node/TypeScript/platform versions, an explicit environment epoch, and sorted input records containing path, file type, mode, byte length and content digest. Directory modes are included; timestamps and absolute checkout paths are not. Content is streamed, symlinks are not followed, and changed files or directory listings during inventory invalidate the observation.

| Bucket | Inputs |
| --- | --- |
| Shared | `src/lib/**`, `src/engine/**`, `src/agents/**`, `src/remotion/**`, `src/geo/**`, `src/motion/**`; Convex generated API/types; `package.json`, **both** npm/pnpm locks, `pnpm-workspace.yaml`, root tsconfig and CI workflow. |
| Convex | Entire `convex/**`, including required schema, auth, crons and tsconfig. |
| Trigger | `src/trigger/**`, `src/assets/**`, `public/fonts/**`, `trigger.config.ts`; `wb_scribe_sync.py`, `whisper_align.py`, `narration_transcript_proof.py`, `mc_page_render.py`, `mc_textplace.py`, `mc_font.py`, `shot_analysis.py`; both `requirements/qa-*.txt` locks. |
| Conservative support | Remaining files under `scripts/`, `requirements/`, `.github/`, `infra/`, `workers/`, `test-fixtures/`, and `public/`, plus the explicitly named root build/package-manager/ignore configuration files. These invalidate **both** providers unless already assigned to Trigger's packaged-file bucket. |
| Conditional UI exclusion | `src/app/**` and `src/components/**`, including globals/module CSS, only while the current guarded runtime dependency inventory has no reference into them. |

Static imports, exports, import types, CommonJS requires and literal dynamic imports are checked against the filesystem inventory. Provider membership propagates through those edges, including cross-provider dependencies. Any runtime-to-UI edge removes the **whole UI exclusion for the consuming provider**; later changes to child components/styles therefore invalidate its fingerprint. Runtime-imported test helpers are checked too, although unused test files are not runtime entry points. Test files remain conservatively hashed.

The existing `verifyMastra` const-for-of loop over literal package names is handled as a finite dynamic import. Unresolved computed imports, missing local imports, local/workspace package links, package import/exports aliases and unreviewed install/deploy lifecycle hooks block the affected inventory. The import analysis is deliberately conservative, not a general JavaScript interpreter or an artifact attestation.

The exact reviewed `trigger.config.ts` and both tsconfigs are pinned by digest inside the versioned policy. **Any recipe/alias edit, even a comment-only edit, requires inventory review and a policy/digest update.** This strictness prevents a new file glob, custom build hook or alias from silently introducing inputs outside the exclusion boundary. It does not prevent deployment; it prevents declaring the inventory complete until reviewed. The current Trigger deploy command is also checked explicitly.

Known local caches, credentials/environment files, generated outputs, Graphify/agent state, the separate `motion-graphics` project, and documentation are excluded. A runtime import resolving into an excluded location fails closed. Unknown locations are reported without traversing them; unknown files inside a declared conservative support bucket are hashed and therefore invalidate when changed. All source/UI symlinks and unsupported file types block reuse eligibility. No blanket "all scripts/public/shared files are frontend-only" rule exists.

This first inventory intentionally over-includes support/test files and shared modules. A UI release that also edits a browser-proof script may therefore still invalidate both runtimes. Savings are presently limited to changes confined to proven UI/documentation inputs; narrowing support buckets needs separate evidence and a policy update.

## Dry inventory and verification

```sh
node scripts/cloud-runtime-fingerprint.mjs
node scripts/cloud-runtime-fingerprint.mjs --root /absolute/frozen/checkout --files
node src/lib/__tests__/cloudRuntimeFingerprint.test.mjs
```

The CLI prints JSON and exits 2 for a blocked inventory or invalid arguments. It cannot execute deployment commands. Its default public targets are `dev:astute-camel-689` and Trigger `proj_vorkjqmnnpkzoiqqgbuu`/`prod`; the existing `TRIGGER_PROJECT_REF` override is honored. The exported function also accepts explicitly resolved public targets, policy version and environment epoch. It does not inspect deployment secrets or infer a verified target from their presence. The default epoch is explicitly `unverified`.

The focused, auto-discovered test executes the real function and real CLI with temporary filesystem fixtures. It covers raw Python/font/QA-lock changes, both package locks, shared code, immutable recipe changes, irrelevant UI/doc edits, same-byte rename, executable/directory modes, deletion/empty requirements, unknown paths, symlinks, escaping/unresolved imports, cross-provider and runtime-to-UI propagation, package aliases/lifecycle hooks, deterministic ordering, public target/environment changes, policy/epoch changes, and a CLI run whose PATH contains no external tools. Provider identities/hashes are never faked as deployment evidence.

Real-repository dry inventory completed with both providers complete and the current UI excluded. The observation includes the local worktree, not a trusted commit or deployed artifact. `/tmp/ysa-runtime-fingerprint-inventory-final.json` is the local diagnostic report; its exact hashes are transient as this implementation/test work is finalized. It must not be used to seed a successful-deployment receipt.

## Bounded caller plan — still unimplemented

1. Run inventory against the trusted immutable CI checkout after dependency/tool installation and **before** the existing final main-revision guard. Verify source provenance/cleanliness and explicitly bind the resolved canonical target and reviewed external-environment epoch. Revalidate generated/codegen inputs if later build steps mutate them.
2. Independently locate each provider's last **verified successful** receipt, including successes from a workflow whose other provider subsequently failed. Missing/expired/malformed/untrusted receipts, policy/tool/target differences, incomplete inventories, active-provider drift or an explicit force rebuild require deployment, never inheritance.
3. Preserve all existing quality/credential gates and non-cancelling deployment serialization. Keep the current main check closest to writes. Matching local input hashes alone are insufficient: verify that the cited provider runtime is still the intended active runtime, including relevant Convex schema/component state.
4. Write each provider's immutable success receipt immediately after that provider's terminal success **and** state verification. Include fingerprint, trusted source SHA, policy/tool/target identity, workflow run/attempt, original runtime identity and completion time. A failed Trigger deployment must not discard a preceding successful Convex receipt. Inherited receipts must cite that original success/version rather than invent a new deployment.
5. Choose and validate durable receipt storage, permissions, retention and provenance. GitHub artifacts using the existing workflow token are a candidate, not implemented storage. External image/APT/package/environment drift is not reproducible source identity; define reviewed epoch/force-refresh behavior before reuse can be enabled.

Before enabling a caller, separately review non-module filesystem/process selectors against this inventory. The AST guard covers the documented module-loading forms, not arbitrary reflective JavaScript, `readFile`/subprocess path construction, or external packages loading local files. A source hash changes when such code is added, but cannot by itself prove that later changes to a newly selected excluded file are covered. Recipe pinning protects the currently reviewed build configuration, not every possible future runtime program.

Trigger's provider `contentHash` is **not** sole authority: installed CLI 4.5.9 computes it from esbuild outputs before later additional-file copying. Its native CLI also emits version outputs before terminal success. The documented `/deployments/latest` endpoint is [unmanaged/self-hosted only](https://trigger.dev/docs/management/deployments/get-latest); Cloud evidence requires [list/get deployment state](https://trigger.dev/docs/management/deployments/retrieve) and active-target verification. Do not use `npm run trigger:deploy -- --dry-run` as a no-write test: installed 4.5.9 enters the native-build branch before the dry-run guard.

No CI caller, skip decision, provider deployment, provider verification adapter or last-success receipt store has been implemented by this foundation.
