# Channel rooms — focused layout and control repair

## Baseline and root cause

The real ChannelFolderWorkspace component put its Rename/Remove menu absolutely below a card inside a horizontally scrolling shelf. The shelf clipped that menu at desktop and mobile; at 200% text its fixed-width Main channels label was also truncated. The local actual-component regression failed all three menu hit tests and the enlarged-name test before any source edit: `/tmp/ysa-room-baseline.log`, `/tmp/ysa-room-component-VaKGk1/`.

## Draft repair

- Keep the horizontal room shelf; scale cards with text size while bounding them to its available width. Names wrap instead of ellipsizing. Avatars sit below the room name instead of squeezing it sideways.
- Expand the existing native room disclosure inside its own card. No portal, new floating window, positioning loop, provider call or new authorization state. Unopened cards do not stretch to the expanded card's height.
- Opening management brings the whole chosen card into view immediately, so its name and controls are visible together. Rename/Remove targets are at least 44 px high.
- Native expanded content spans the card's grid columns. The `::details-content` behavior is documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::details-content); older-engine presentation is not claimed as tested.

## Validation performed

`scripts/channel-room-browser-proof.mts` bundles the **actual component and CSS module**, using the actual compiled app theme. It explicitly substitutes owner/viewer context, asset signing and mutation transport in a local-only fixture; every external request is blocked. It does not use a production owner session or claim backend mutation success. The checks prove visible/hit-testable management, complete Main channels text, the real Rename event's exact API name/arguments, and the absence of owner controls/calls for a viewer. The existing actual Convex folder-lock handler test separately passes without modifying the handler.

Pass 1 exposed another visual problem: opening management could leave the room name partly outside the shelf even though the button itself was clickable. Pass 2 checks the whole card's horizontal containment after opening, and the implementation reveals that card. `/tmp/ysa-room-pass2.log` and `/tmp/ysa-room-component-sK9r0d/` show three passing viewport/font cases with no browser errors or external calls. Desktop and enlarged-text images were inspected. An initial harness type declaration referenced an unavailable top-level esbuild package; it was corrected to type the already-installed tsx dependency boundary. No package was installed or dependency changed. Final root typecheck and scoped lint passed (`/tmp/ysa-room-final-typecheck.log`, `/tmp/ysa-room-final-lint.log`).

`scripts/channel-room-live-proof.mts` separately checks the actual read-only Channels page using existing production records. Local mode proxies only public viewer-token/asset signing; production mode has no overrides. It selects the actual saved room and returns to Main channels, checks the full label and viewer restriction, and captures desktop/mobile/200% text. `/tmp/ysa-room-live-local.log`, `/tmp/ysa-room-live-jUxWHn/`: three cases, one actual room, no page errors. These are room-record/selection checks, not channel artwork readiness or whole-page qualification.

## Remaining gates

A stronger rename-form geometry check then failed the desktop target-size requirement (`/tmp/ysa-room-form-baseline.log`). The input and Save/Cancel controls now have 44 px minimum height and the input can shrink within the card; the form spans its complete grid row. The final third-pass proof records these checks in addition to menu access and exact Rename arguments (`/tmp/ysa-room-pass3.log`). It is still not a production owner-mutation test.

This draft is not deployed. Full isolated release tests/build and the exact production proof are still required. Real owner folder mutations were not performed on production merely for a layout test. Other folder concerns (rename/remove failure recovery, keyboard workflow and older-browser behavior), Golden summary-count reflow, broader channel controls/artwork, and all remaining goal items stay open. No render credit was required and no lock or provider-quality boundary was changed.

## Release gate in progress

Frozen candidate `9f173c541936243d3330c83a942fefc1cb203d40` on `checkpoint/channel-room-layout-contract-20260909`, parent production navigation `2fcbc31`, contains only the room change/proofs and updated UI reports. The full test/assembly, typecheck→lint→build and audit→defect-proof chains are running in `/tmp/ysa-room-release-WeEBrB/repo`. Logs: `/tmp/ysa-room-release-tests.log`, `/tmp/ysa-room-release-typecheck.log`, `/tmp/ysa-room-release-lint.log`, `/tmp/ysa-room-release-build.log`, `/tmp/ysa-room-release-audits.log`, `/tmp/ysa-room-release-defect-proof.log`. Do not push this candidate to main unless those gates finish successfully, then verify the provider release, exact alias and the production-mode room proof. The separate navigation cloud CI `34346555151` is still running; media CI `34344663820` is complete.

Combined held work is checkpointed at `7edcca3527c136cd79509503b2032b520ae7cb10` on `checkpoint/channel-room-layout-with-held-work-20260909`. Main checkout HEAD/index are preserved. The owned local viewer build on port 3312 contains navigation and room drafts; port 3010 was not modified. Final room graph update: 21,600 nodes, 52,737 edges, 704 communities, code-only/no paid extraction, excluded from application inputs. All 151 numbered goal requirements are retained and unique. The next useful work after this slice remains the Golden summary reflow and broader module/backend qualification; an unavailable render-credit step does not pause that work.
