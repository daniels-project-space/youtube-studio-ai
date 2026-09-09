# Navigation reflow — 9 September 2026

## Reproduced defect

The production navigation at 390 px and 200% root text had five fixed-width targets inside a fixed 69 px bar. Channels, Production and Schedule exceeded their targets; the targets extended 44.78 px below the viewport. The More button also overrode its sibling font size. The read-only baseline failed its text/target containment check before implementation: `/tmp/ysa-navigation-production-baseline.log`, screenshot `/tmp/ysa-navigation-reflow-xcKb6O/large-text.png`.

## Focused changes

- Use a content-height dock and a container-width breakpoint. Normal phones retain four direct destinations plus More; narrow/effectively narrow layouts show Studio, Channels and More. Production and Schedule move into that menu rather than disappear.
- Indicate the active moved route on More. Preserve Library, Settings and the two existing insight destinations; no specialist navigation dump is reintroduced.
- Increase small dock labels from 0.59 to 0.68 rem; remove More's conflicting font shorthand. Desktop targets are at least 44 px. The desktop rail and workspace offset scale together with text size.
- Let the channel selector use available space, wrap complete names, and expand its bounded scrollable list. Remove cryptic one-letter template codes. No new subscription or permission change.
- Escape from a focused menu item restores focus to its trigger; a channel selection also restores focus. Closing unrelated UI does not steal focus.

## Actual checks and iterations

`src/components/Navigation.test.tsx` renders the actual Sidebar/NavItem with only the router context supplied by the harness. It checks real destinations, active/compact state and specialist-link boundaries. Existing visual/release contracts pass. This is complemented by actual browser interactions, not treated as a standalone functionality proof.

`scripts/navigation-layout-browser-proof.mts` loads Channels, Library, Production and Golden modules at 320/390/768/1440 px, including mobile and desktop 200% text. Local mode uses only the production public viewer-token/asset endpoints; no owner token or fabricated data. Production mode has no overrides. It waits for actual channel records, measures text and target bounds, opens More by keyboard, follows Library, checks Escape focus return, selects a real channel and resets to All channels. On desktop it opens Tools and verifies each focused destination is actually exposed and hit-testable in the scrolling rail. Channel switching only changes the isolated browser's view; there is no publishing, render or server mutation.

Visual iterations found and corrected a still-truncated channel trigger, a narrow dropdown splitting short names, small desktop targets and unhelpful template labels. Final local evidence: `/tmp/ysa-navigation-pass6.log`, `/tmp/ysa-navigation-reflow-WqLsPt/` — six cases, no page errors. The 200% dock now has three approximately 115 px-wide targets fully within the viewport, with a 98.42 px content-height bar. Phone, small-phone menu and enlarged channel-list screenshots were inspected directly.

Earlier proof attempts are retained, not counted as success: context teardown masked an assertion through an in-flight local proxy request; cleanup now suppresses only disposed-route errors while reporting the original case failure. A stronger desktop navigation check initially tried a link inside collapsed Tools; the proof now opens the actual disclosure before focusing it. Another direct local diagnostic without the viewer endpoint proxy could not hydrate; it is not live verification evidence.

## Release evidence and remaining scope

Scoped release `2fcbc31f97fcd922acbef81db78ef1791022a7d3` passed all 631 direct readiness tests, actual 31.021995-second 1920×1080 hermetic assembly, typecheck, production build, unchanged structural audits and all 24 defect-baseline proofs. Lint: zero errors and 33 existing warnings. Logs `/tmp/ysa-navigation-release-tests.log`, `/tmp/ysa-navigation-release-typecheck.log`, `/tmp/ysa-navigation-release-build.log`, `/tmp/ysa-navigation-release-lint.log`, `/tmp/ysa-navigation-release-audits.log`, `/tmp/ysa-navigation-release-defect-proof.log`; assembly `/tmp/assembly-smoke-DsjTtK/bk_smoke_2_loudnorm.mp4`.

After that gate, Vercel reported success and the exact production health endpoint returned `2fcbc31f97fcd922acbef81db78ef1791022a7d3`. The unmodified production browser proof passed all six cases with no endpoint overrides or page errors: `/tmp/ysa-navigation-production-2fcbc31.log`, `/tmp/ysa-navigation-reflow-JdBukv/`. Production enlarged-text More and phone Golden-page screenshots were visually inspected. Real channel selection, route navigation, scroll-revealed desktop focus and Escape return passed; no owner/publishing action was used. [Cloud CI 34346555151](https://github.com/daniels-project-space/youtube-studio-ai/actions/runs/34346555151) is still running; cloud completion for this revision is not yet claimed.

There are still unrelated enlarged-text issues in page interiors, including channel-room labels and Golden summary counts; a passing navigation check does not certify those pages or complete the 151-item goal. The room fix is a separate draft. No provider credit was needed, no paid route was substituted, and owner locks/YouTube authorization are unchanged. Graphify traced this repair through the shared shell components and was refreshed after the source changes; its generated graph remains outside deployment inputs.

Cloud receipt update: CI `34346555151` completed successfully. Canonical Convex was ready at **11:48:31 UTC**, and Trigger **20260909.10** deployed at **11:50:26 UTC**, worker `worker_cmtu1dw4w4hrh0jne8e5lymtk`, content hash `101fa3a5b4b7ad6781cca1df216d69e9`. `/tmp/ysa-navigation-cloud-deploy.log` records both. The production health endpoint was checked again at full `2fcbc31` before advancing to the separate room release. This supersedes the pending cloud status above, not the remaining page-interior limitations.
