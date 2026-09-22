# Integrated YuE2 verification

## Test-Scope Correction

The historical 896-file runs below excluded filenames only. A later inspection
found direct thumbnail coverage inside mixed files, including
`src/engine/__tests__/recoveryPolicy.test.ts`. Therefore those runs do **not**
prove that zero thumbnail regression cases executed. The known mixed recovery
case uses a synthetic fixture and asserts zero paid thumbnail calls; it is not
thumbnail generation. The recorded pass counts and hashes remain accurate, but
earlier blanket statements that no thumbnail tests ran were too broad.

The opt-in `--exclude-thumbnail` selector now rejects both matching paths and
test files containing direct thumbnail references. On the source inventory
after adding the focused retry-policy test, it selects 770 of 927 files and
excludes 157. A source-read failure aborts selection before execution. This is
deliberately conservative and may exclude otherwise useful mixed coverage;
it is not a transitive call-graph proof about dynamically invoked helpers.
The default production suite remains unchanged and includes every discovered
test. No reduced selection can substitute for its release gate.

## Historical Checkpoints

Verified at 2026-09-22 08:36 UTC against clean source commit
`66847c2ad3ff114ee1d900c553c6fbd2aa94aebc`. No application code changed during
this verification. This closes the full-suite gap documented in the preceding
metadata and YuE2 preview changes, not the overall MVP or release requirements.

## Results

- Fresh `npm run build` passed, including TypeScript.
- Fresh network-isolated non-thumbnail readiness: **896/896 selected files
  passed, 30 thumbnail-named files excluded**. This is not complete production
  readiness; the excluded release coverage remains unverified.
- The real Next production server handled HTTP requests inside a network
  namespace with loopback only. No external interface was available.
- Lo-Fi repeat, meditation repeat/once, narration once, and Shorts once each
  returned the exact fingerprint produced by the executable designer.
- Each case distinguished the legacy selection and a changed seed, returned
  no-store responses, and rejected four malformed selections. Malformed JSON
  returned 400; an oversized body returned 413.
- Runtime design continued to report YuE2 as not production-qualified.
- The temporary server exited after verification; no dev server was left running.

The first local HTTP attempt stopped on the expected `development` health label.
The successful attempt supplied `RELEASE_SHA` from the verified source commit.
That health label is operator-supplied release metadata, not an independently
measured binary digest. Source cleanliness, the fresh build, and fingerprint
comparisons are the separate evidence for the code tested here.

## Local Evidence

| Artifact | SHA-256 |
| --- | --- |
| `/tmp/studio-yue2-integrated-readiness-20260922.log` | `ceec3bf402e9d8d901e59b0bc90959c5b0bd95b98933dc3402102c16a6a6e477` |
| `/tmp/studio-yue2-integrated-build-20260922.log` | `8f3c0134766829892db6cd30d12bce7ee4d3aeec380d03feb815bff0eb61a4e6` |
| `/tmp/studio-yue2-production-http-20260922.ts` | `00540c132f4b85451d088e08eecc31eb9ee0d8f7958195af5e3f9148d9a10517` |
| `/tmp/studio-yue2-production-http-final-20260922.log` | `fafd76e0dbe09c3378785bedb2c5c6665b400abed12648ecf55437c8f900f004` |

The operator harness was invoked through `/tmp/studio-offline-readiness.mjs`
under `unshare --net`; the wrapper enables only namespace-local loopback.
Source-rate/allocation values in the HTTP fixture are synthetic contract inputs,
not current price evidence, a GPU reservation, or spending authorization.

## Live Boundaries

The canonical production health endpoint still reports
`722facc4f5aaad004dcd9f96de3be7a29951a520`; this branch is not deployed there.
At this 08:36 UTC checkpoint, the canonical vault OpenRelay key fingerprint was unchanged from the previously
revoked key. No fresh provider authentication attempt or GPU start was made.
No secrets are included in this record.

This turn generated no music, thumbnails, or final videos and made no publishing
request. Musical quality, owner listening approval, new-runtime GPU execution,
complete release coverage, and the broader module-first backlog remain open.

## Subsequent Frozen-Identity Checkpoint

Clean source `3a2793394bd47b2afd1d30d474de4d285cbd84ca` passed a fresh
network-isolated readiness run: **896/896 selected files, 30 thumbnail-named
files excluded**. The process exited successfully. Source revision and clean
worktree were checked before and after the run; no application files changed.
This includes the shared OpenRelay error-safety fix and the new frozen-identity
YuE2 program version, not just their focused regression tests.

The same HTTP harness also passed against the production build produced during
the preceding implementation turn. All five family/playback paths retained
exact preview/runtime fingerprints, source-seed sensitivity, legacy distinction,
invalid-selection rejection, and the YuE2 production hold. Malformed JSON and
oversized requests were rejected. Its temporary server exited successfully.
The supplied health revision remains release metadata, not a binary digest;
the fingerprint comparisons independently test the selected graph behavior.

| Artifact | SHA-256 |
| --- | --- |
| `/tmp/studio-readiness-3a279339.log` | `637b9a3319668c0ef8f12872125729fd29892c8005673aaa99f824eb724a4fdb` |
| `/tmp/studio-http-3a279339.log` | `bbc8cf27beffc58172da5709c23d373c696c32c4d7f9d4e52bb651b21455f001` |

The unchanged harness hash is recorded above. The live production health check
at `2026-09-22T09:18:46.375Z` returned HTTP 200, no-store, and revision
`722facc4f5aaad004dcd9f96de3be7a29951a520`, so the branch is still not deployed.

The earlier revoked-key observation is superseded by
`openrelay-vault-recovery-20260922.md`: canonical read access was recovered,
but the subsequent restart request was denied with 403 and the VM was verified
stopped. This checkpoint did not retry that write or spend on GPU generation.
No thumbnail tests/generation, owner musical approval, complete release gate,
or production rollout is claimed. The full MVP and additive backlog stay open.
