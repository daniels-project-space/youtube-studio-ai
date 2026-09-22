# Shared Task Retry Policy

The engine classifier already marks unknown failures as `retryable: false`.
The Trigger adapter checked only `kind === "deterministic"`, however, leaving
unknown errors as ordinary thrown errors eligible for task retries. This
contradicted the remote worker's documented concrete-transient-only policy.

The adapter now follows `classification.retryable`. Unknown and deterministic
failures become the installed SDK's `AbortTaskRunError`; failures with concrete
transient signals retain the original object, delay, and durable retry scope.
Unclassified failures need diagnosis instead of an automatic additional task
attempt. No model, quality threshold, artifact recovery rule, lease, provider
retry budget, or production scheduling configuration was weakened.

Focused regression tests reproduced the mismatch before the change and passed
after it. Five selected files passed (11 reported test cases), including the
actual parent task callback and retry enqueue boundaries, metadata execution
leases, and 13 stage-reuse runner cases. External networking was disabled and
no provider work was performed. Tests of the selection helper use inert source
strings; they do not execute thumbnail fixtures.

The accompanying test-selection correction and historical coverage limitation
are recorded in `yue2-integrated-verification-20260922.md`. Neither the corrected
770-file selection nor the unchanged complete release suite was run for this
patch. These changes are not proof of deployed behavior or measured billing
savings.
