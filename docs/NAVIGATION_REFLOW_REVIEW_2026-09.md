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

## Remaining gate and scope

Full isolated readiness/build/audit gate and exact production deployment are still required for this navigation change. Media release `1ded1d6` is separately live, not proof of this draft. There are still unrelated enlarged-text issues in page interiors, including channel-room labels and Golden summary counts; a passing navigation check does not certify those pages or complete the 151-item goal. No provider credit was needed, no paid route was substituted, and owner locks/YouTube authorization are unchanged.
