# Title oracle fixture authorship correction

Recorded 9 September 2026 after the frozen first and second calibration passes.

Both `title-oracle-calibration.json` and `title-oracle-holdout.json` were authored
by a separate coding-agent task. Their policy/provenance fields saying
`Human-designed` or `human_designed...` are incorrect. They are **agent-authored
engineering expectations**, not human annotations, owner approval, audience
preferences or outputs from the Gemini judge being tested. They were reviewed
by the coordinating coding agent, not an independent human panel.

The exact JSON bytes remain frozen because receipts bind their whole-file
hashes. This erratum changes attribution only: no case, title, source, expected
label or measured result is revised. Policy and provenance fields were never
sent to the judge; only the allowlisted `args` and `candidates` were sent.

- Calibration SHA-256:
  `73123e875e0c5c8c339cc216d437f27300d1ecea92dff3d0f63798aa6f46cffd`.
- Holdout SHA-256:
  `69d5f205d6a1c850cc681602269f405c2242084c1bf1fe972b0f2fd921ce82a3`.

The held-out cases were withheld from the prompt-editing task until source
freeze, but this is task separation, not independent human evidence. No result
establishes virality, CTR, universal quality or owner-choice agreement.
