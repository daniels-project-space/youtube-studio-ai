# Integrated YuE2 verification

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
The canonical vault OpenRelay key fingerprint is unchanged from the previously
revoked key. No fresh provider authentication attempt or GPU start was made.
No secrets are included in this record.

This turn generated no music, thumbnails, or final videos and made no publishing
request. Musical quality, owner listening approval, new-runtime GPU execution,
complete release coverage, and the broader module-first backlog remain open.
