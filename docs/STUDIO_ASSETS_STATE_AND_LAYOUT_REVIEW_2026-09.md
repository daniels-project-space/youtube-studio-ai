# Studio assets — truthful inventory and compact layout

## Scope and root causes

This is a separate UI/data-lifecycle slice after Golden evidence release `aa96282`. No asset registry mutation, render admission, reuse policy, OAuth authority, worker configuration, or thumbnail module is changed. Owner-only operations remain owner-only. The goal's older requirements remain active.

The production destination audit exposed an oversized decorative registry map and repeated owner gate. Source and current API inspection confirmed a real state bug: default empty arrays were presented as approved/portable counts and an unattested runtime **before the owner-only inventory loaded**. Failed responses could keep old candidates actionable, missing arrays were accepted as empty, channel-only reusable clips were counted as portable, and owner transitions retained private state in the mounted page.

Graphify traced `StudioAssetsPage` to `useOperationsAccess`; the actual GET/POST/preview route and recent page history were inspected. Serena was unavailable. Next's installed CSS/accessibility guides were read before editing. There were no owner lock markers on the affected files.

## Three implementation and visual passes

1. Replace the orbit/duplicate gate with a compact title and one access notice; expose summary counts only after a current successful inventory. Required collections must be present. Separate failed inventory reads from action messages. Mount private state only for owner access and abort pending requests when it unmounts. Count only approved portable Studio-scoped assets as Studio-wide; channel-only clips are excluded.
2. Use the actual five sections with native keyboard-operable selection buttons, larger text, wrapping evidence, 44 px targets and expandable reuse rules. Remove duplicated decision/character headers. Let a lone card fill the available row and its facts use available columns. Revoked images no longer offer an approved-image preview. Preview/approval requests share the active inventory lifecycle signal; an unmounted approval cannot initiate a fresh registry read.
3. Visual review caught enlarged-text section names splitting inside forced two-column controls. Let label/font width choose the number of buttons per row. Rerun the full browser scenario set and the real local app independently; inspect desktop decisions, mobile inventory and enlarged catalog layouts.

## Evidence and limits

- Initial **actual-component** browser baseline: 64 failures, no browser errors or external requests (`/tmp/ysa-studio-assets-baseline.log`, `/tmp/ysa-studio-assets-egccEX/results.json`). The unchanged page/provider/CSS were bundled; only HTTP fixtures and Next's pathname were supplied. No real owner or production mutation was used.
- Pass 1: all 32 state/layout cases passed (`/tmp/ysa-studio-assets-pass1.log`, `/tmp/ysa-studio-assets-EmJ6e6/`). States cover viewer, checking, unavailable access, loading, failed request, incomplete response, genuine empty inventory and populated inventory.
- Expanded passes 2 and 3 additionally visit all sections, test exact preview fingerprint and image decoding, rejected preview, Escape/focus return, exact approval payload, rejected and successful approval, inventory refresh, failed refresh, successful retry, keyboard reuse rules and cancellation on unmount. Both passed without external requests or browser errors (`/tmp/ysa-studio-assets-pass2.log`, `/tmp/ysa-studio-assets-6sgqle/`; `/tmp/ysa-studio-assets-pass3.log`, `/tmp/ysa-studio-assets-41Zhwb/`). Fixtures are explicitly labelled and are not quality or real-owner workflow proof.
- The **real production** read-only baseline fails 11 checks across five layouts (`/tmp/ysa-studio-assets-live-baseline.log`, `/tmp/ysa-studio-assets-live-QtBahP/`). Viewer content occupies 1,020 px desktop / 1,528 px phone despite having no accessible inventory; false zero/unattested claims appear in every layout.
- The real local app passes the same read-only test at desktop, phone, 320 px and 200% text (`/tmp/ysa-studio-assets-live-local.log`, `/tmp/ysa-studio-assets-live-MYBRby/`). Content is 288 px desktop / 348 px phone: 72% / 77% less vertical space. No private inventory request, overflow or browser error; the real authorize link is correctly wired, keyboard reachable and at least 44 px high. Local proof proxies only anonymous, read-only session/asset-URL GETs from production; it grants no owner access.
- Source/API guard tests pass; root typecheck/scoped lint pass. No dependency, paid model, GPU, storage, publishing or real approval operation is needed for this slice.

The frozen full release gate, provider/exact-alias verification and **production** version of the final proof remain required. This does not qualify genuine owner OAuth, real registry contents, asset-generation quality, automated library promotion or weekly prepared-media use. Those remain on the goal ledger.
