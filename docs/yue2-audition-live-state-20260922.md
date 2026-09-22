# Confirmed audition state in the review panel

The browser regression reproduced a saved `needs_work` decision while the
panel header still displayed `Needs audition`. Successful form submissions
updated only the form's private state, and the surrounding review always
displayed unverified personality fit, including after an approved audition.

The form now forwards its validated save response to the enclosing review.
The panel updates only the matching candidate and distinguishes needs-work,
rejected, promising, approved-for-assembly and stale approval states. It names
the owner's personality judgment without claiming independent audio quality.
Production and publishing remain unapproved. Technical blocks, missing context,
missing frozen-invocation authority or inactive approval receipts cannot display
an active source approval.

No extra GET follows a save. The existing verified POST response supplies the
decision, avoiding a redundant retained-audio read merely to refresh the header.
Failed, conflicting and malformed responses leave the saved panel decision
unchanged. The response is checked with the existing full audition validator,
including ordered sections and complete positive judgments, before propagation.
No backend approval or continuation rule changed.

The same browser pass exposed clipping of the long verdict options at 320px
with enlarged text. Shorter labels and a bounded select width keep all options
readable without changing their values or authorization semantics.

Verification: actual React components in Playwright with a synthetic local API
and a decoded 48 kHz FLOAT WAV; successful and failed saves, revocation, request
counts, playback/seeking, stale-run isolation, desktop/mobile/large-text layouts
and measured verdict-label fit pass. Screenshots were inspected. Final evidence:
`/tmp/yue-review-browser-yfCQDo`. The authenticated route and audition contract
tests, scoped lint, TypeScript and production build pass.

These tests do not record an owner decision against a real candidate. No GPU,
thumbnail generation/tests, channel mutation, publishing or production deployment
occurred. The module-first MVP remains incomplete.
