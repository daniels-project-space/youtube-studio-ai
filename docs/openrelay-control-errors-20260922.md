# OpenRelay Control-Plane Error Safety

## Live Authorization Evidence

After the denied retained-VM restart, fresh canonical-vault reads returned HTTP
200 from both `/v1/whoami` and the organization's API-key metadata endpoint.
The identity still reports the expected organization and `clusters:read`,
`vms:read`, `vms:write`. Metadata lists active and revoked keys; it neither
returns their secrets nor proves that any other key can restart this VM.

The current [authentication contract](https://docs.openrelay.inc/docs/authentication)
and [error contract](https://docs.openrelay.inc/docs/errors) describe 403 as a
scope or organization authorization failure. They do not identify the exact
scope required by the retained VM's denied restart. No unchanged restart retry,
new allocation, permission expansion, or additional GPU spend was attempted.
The exact provider-side permission issue remains unresolved.

## Shared Client Fix

Reviewing that failure exposed a separate defect: `OpenRelayVmClient` copied the
first 220 characters of arbitrary provider error bodies into thrown errors.
Truncation did not prevent a provider from echoing a bearer credential into task
logs. A regression test reproduced that leak with a fake credential.

The client now reads at most 4 KiB of error JSON and retains only an allowlisted
machine code and a structurally valid UUID request ID. It cancels oversized or
unreadable error streams, drops free-form error messages and unknown codes,
rejects redirects, and uses fixed transport/JSON-parse diagnostics. The shared
H3 and Qwen lifecycle callers retain their existing status-based behavior. No
automatic write retry was added.

## Verification

- Four focused test files passed in a network namespace with loopback only:
  shared VM control, H3 lifecycle, Qwen lifecycle, and YuE2 admission.
- Real local HTTP responses verified credential-echo suppression and refusal
  to contact a redirect destination; no live provider write was used.
- Streaming-body regression verified cancellation at the diagnostic byte cap.
- Malformed JSON, HTML, oversized bodies, untrusted codes/IDs, and transport
  exceptions cannot copy the fixture credential into the resulting error.
- Production build, TypeScript, and scoped ESLint passed.

This does not prove GPU write access, deployment of the new runtime, musical
quality, or production rollout of this branch. No thumbnail tests or generation
were run.
