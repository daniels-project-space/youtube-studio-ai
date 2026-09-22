# Final Assembly Storage Recovery

Both shared final assemblers previously uploaded their completed master directly.
A transient storage failure escaped as a retryable stage error after expensive
encoding. A regression reproduced this with a 503 from the loop master upload.

Loop and narrated assembly now use the existing `persistRenderedFile` helper:

- Retry the same completed local file, at most three storage attempts.
- Preserve the streaming upload path, output key, content type and media settings.
- Recheck the existing output-authority callback before every attempt. The old
  standalone check moved into the helper, so successful uploads add no check.
- Mark exhausted, permanent or unknown storage failures non-retryable, avoiding
  automatic re-execution of the expensive producer for that upload failure.

This is shared persistence behavior, not a channel migration or a new creative
pipeline. Legacy timing, source selection and optional repair-checkpoint behavior
are unchanged. It does not cover failures after upload such as asset registration,
and it does not establish a durable operator upload-resume queue.

## Evidence

The registered YuE2 loop and narrated module fixtures exercise their actual
assembly control flow with synthetic storage and approval transports. Each proves
one render across transient recovery, three attempts at exhaustion with a
non-retryable error, and no second attempt after approval revocation. Existing
source integrity, exact loop duration and legacy timing assertions also pass.

The separate persistence tests cover permanent failures, unknown errors and
bounded backoff. Trigger retry-policy tests verify terminal errors remain terminal
at the task boundary. Tests run with external networking disabled.

The assembly fixture's real-FFmpeg mode produced a 1920x1080, 300-frame,
10-second diagnostic master with 48 kHz audio. Decoded signal measurements found
both source music and narration and rejected an unrelated source tone. The master
SHA-256 was `b4728c643a6a2b3a787e77dbd39959ca94c49ea16d6cad7c773397863747c06d`.
Source, approval and remote transports remain synthetic; this proves local
composition, not musical approval or live object-storage recovery.

Production build/TypeScript, scoped lint and structural audits passed. No
thumbnail tests, provider generation, GPU start, publishing or deployment was
performed. Provider-bill savings have not been measured.
