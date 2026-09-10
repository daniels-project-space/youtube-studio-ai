# Shell labels: preserve words and usable targets

## Scope and actual before evidence

This isolated change is based exactly on production
`98ca6829bfebff84dcc8a2b95abe1bbfccbbe33e`. Application changes are confined
to `src/app/globals.css`; AppShell, Sidebar, ChannelSwitcher and NavItem remain
byte-identical. Owner locks were empty before edits. No canonical edits,
commit, deployment, paid call or production mutation was performed.

The final same-script no-overlay baseline is
`/tmp/ysa-shell-label-proof-E136eN/results.json`, terminal exit 1. All six
profiles completed actual interactions, retaining six separate layout failures:

- At 320px/200% root text, `channels` splits across two lines within the word.
  Selecting the actual listed Rainy Neon Lofi channel also splits `Rainy` and
  `Neon` within their words.
- The 97.08px-wide dock Channels text exceeds its 91.73px selected target.
  Three equal zero-minimum columns do not reserve its text plus inline padding.
- The right-anchored dropdown's minimum width ignores the adjacent owner
  control. It extends left of the viewport at 320px normal/enlarged and 390px
  enlarged text (x=-33.58px/-23.19px).

The dropdown issue was separately authorized after its actual screenshot and
bounds reproduction. This is not permission to hide owner actions.

## Small layout correction and visual passes

The compact dock uses content-minimum tracks and smaller **horizontal padding**,
not smaller text. The longest label gets a complete 111.86px target at the
320px enlarged profile; all three real controls still fit. Existing compact
navigation moves Production/Schedule into More, with no new hidden destination.

The mobile topbar reserves usable space for the action group and allows it to
reflow. A container query removes only the duplicate, noninteractive mobile
brand at very narrow effective widths; the selector retains the Studio mark or
channel avatar. All actual actions and font sizes remain unchanged. This second
visual pass removes the unnecessary lone-brand row in the first passing draft.
Header heights at 320px/200% and 390px/200% improve respectively from
181.69→146.66px and 146.66→111.63px. Normal phone and both desktop profiles have
unchanged heights. No key navigation text is clipped, ellipsized or shrunk.

The mobile dropdown is anchored to the complete action group, including the
owner control, instead of a narrow selector ending before that control. It
uses that group's bounded width and keeps native vertical scrolling, complete
option words, current-selection indication and focus restoration. Desktop
dropdown styles are unchanged.

## Final actual-app proof

`scripts/shell-label-reflow-browser-proof.mts` freezes itself and any candidate
source during execution. It loads actual production DOM, public read-only
subscriptions and actual channel records. Candidate mode compares CSSOM rules
against exact 98ca source, admits only seven explicitly scoped changed rules,
and injects that source-derived delta. It records the delta, hashes and mode:
**SOURCE-DERIVED-CANDIDATE-OVERLAY-NOT-DEPLOYED**. It does not serve fixture HTML
or invent channel/asset/auth data. The empty CSS parser page alone supplies
tsx's nested-function naming helper; the actual application never receives it.

Final candidate: `/tmp/ysa-shell-label-proof-YzXFei/results.json`, exit 0,
six of six profiles (320, 390 and 1440px, each normal and 200% root text).
The same final proof produces the failing baseline above. Both assert exact
98ca health before and after every profile and retain complete context images.

Checks include whole-word text rectangles inside the actual selected target,
all 14 real channel options individually scrolled and hit-tested in each of
six profiles, menu viewport bounds, channel selection/reset and selected state,
keyboard Enter/Escape and returned focus, More links to Production/Schedule/
Library, desktop scroll-revealed focus, and the distinct Library topbar with
its intentionally absent owner trigger. HTTP non-read methods and outgoing
Convex Mutation/Action frames are blocked and recorded; every final profile
has zero attempted writes and zero page errors. Channel selection changes
only its fresh browser context's view. Owner authorization is not exercised.

Loaded-page normal/enlarged phone and desktop shell captures, selected-channel
captures, enlarged dropdown, native-scrolled final options and More menu were
inspected. The final proof waits for real Library/channel cards, not just an
unhydrated shell. Existing channel-room interior truncation/overlap remains
visible in these screenshots and is not claimed fixed by this shell patch.
Artwork/media loading or quality is not an acceptance gate for this scope.

Frozen application CSS SHA-256:
`4e8ce98e1fb03f98e75e8a6721e0a9deea7876238638b954442e3504b75f5ef9`.
Frozen proof SHA-256:
`ece479a531e9d2b9b66c1f355fd6b1b984301b96c2fa8925c28f81f8540b89d8`.

## Local checks, honest iterations and release boundary

Evidence root: `/tmp/ysa-shell-label-reflow-aZnE8w`.
The existing actual Navigation component test, operator visual consistency and
channel UI contracts pass under the network-denying test fence. Isolated
nonincremental project typecheck, standalone strict browser-proof typecheck,
scoped ESLint and whitespace checks pass. No source assertion or threshold was
loosened to obtain these results.

Initial harness failures are retained separately: an overly restrictive exact
accessible-name locator for Inked Histories timed out. The channel does exist;
its avatar contributes an accessible name as well as its visible text. Selecting
a genuine listed option and separately asserting its displayed name/selected
state corrects the harness, not application data. A pure CSS-parser page lacked
tsx's naming helper; no app case
ran in that attempt. The initial walker measured closed Tools descendants;
`checkVisibility` now excludes genuinely unpainted text. The original standalone
typecheck command omitted DOM.Iterable; the corrected full DOM typing passes.
The first passing candidate remains retained as `candidate-first-passing.css`
and `/tmp/ysa-shell-label-proof-nuI3WX`, followed by the smaller-header pass.
Final loaded-page baseline/candidate both use the identical frozen proof.

Installed Next styling documentation was read in full, including CSS ordering
and production differences. Shared Graphify queries traced exact shell
components before source edits; Serena is unavailable in this session. Parent
owns the canonical graph update when integrating this isolated source.

**Not released:** source-derived overlays prove this candidate's behavior, not
the production stylesheet order or a deployed fix. The isolated worktree uses
external dependency symlinks, unsuitable for the exact Turbopack build; the
coordinator must run its clean in-root-dependency production build, independent
review and no-overlay replay on the exact released revision. No whole-page
accessibility, different browser-engine/device zoom behavior, publishing or
owner-permission readiness is implied by these bounded Chromium root-text tests.

## Independent combined release candidate

The coordinator replayed the unchanged frozen browser proof independently:
`/tmp/ysa-shell-label-proof-K60lxp/results.json`, terminal 0, six profiles,
all 14 actual options in each, no writes or page errors. Normal and enlarged
phone captures were inspected directly. This remains candidate-overlay proof.

The exact stylesheet/proof and ordinary narration preflight runtime/test were
then composed onto exact 98ca in `/tmp/ysa-seed-build-mIHmro/repo`. Actual
production build, post-build nonincremental typecheck, full lint (zero errors,
33 unchanged baseline warnings), and the three existing Navigation/operator/
channel UI contracts pass. Evidence is `/tmp/ysa-narration-shell-*.log`.
The identical narration runtime/test independently passed all 651 direct
readiness tests and all twelve unchanged structural audits before composition.
Production alias and cloud deployment verification, including a no-overlay
browser replay, still remain release gates rather than claims of this document.
