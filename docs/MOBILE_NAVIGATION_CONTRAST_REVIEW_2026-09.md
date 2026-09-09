# Mobile navigation reading surfaces

Status: three local passes complete; frozen release gate and production verification pending.

## Defect and bounded repair

The separately released top-bar repair did not cover the mobile dock or its More menu. Actual enlarged Lo-Fi screenshots showed underlying headings crossing navigation labels. The shared mobile CSS used a 90% opaque dock and 98% opaque menu, with inherited backdrop filters. Keep the existing gradients, routes, spacing, adaptive three/five-target layout and controls; use opaque bases and override the unnecessary mobile filters. Desktop rail styling and page surfaces are unchanged. No extra component, animation, dependency or data subscription is added.

Graphify traced `Sidebar` into `AppShell`, followed by focused source/CSS and actual component tests. The installed Next CSS/accessibility documentation was read. Owner locks were checked; no locked channel/module or owner workflow is changed.

## Three passes and the independent oracle

1. **Reproduce:** extend the existing real-page header pixel comparison to dock and expanded More menu, including enlarged Lo-Fi. On production `41a4b76`, eleven surface cases fail: underlying content changes 45.96% of Library dock pixels and 28.18% of the enlarged Lo-Fi menu's painted pixels. All nine header cases remain clean. The enlarged Assets dock happens not to overlay content in this scroll position and is not cited as a defect reproduction.
2. **Repair and inspect:** opaque CSS clears the visible bleed. The first rectangular menu comparison still reports 0.10–0.23% differences because it includes page pixels outside the menu's rounded corners. Inspected full screenshots show those external corners; the oracle now uses the actual computed corner radii and excludes only exterior pixels/one-pixel antialiased contour, while retaining the original RGB tolerance and failure threshold. It is rerun on the old production source, which still fails the same eleven cases. This oracle correction is not hidden as an application fix.
3. **Revalidate:** all 21 painted-surface comparisons across nine real page/viewport/text cases now report zero changed pixels, zero browser errors and zero private-inventory requests. Six separate real navigation journeys verify visible target bounds, full route reachability, Library navigation, More/Escape focus return and real channel selection/restoration. Small-phone and 200%-text screenshots were inspected. Both menu and dock preserve their gradient and focus treatment.

The browser uses actual local application components and real public production GET responses for authentication/read-only asset endpoints, not mocked channel cards, owner elevation or generated screenshots. The native browser decodes screenshots for comparison. Actual-component tests additionally guard routes, compact state, specialist-link boundaries and opaque surface CSS. A local Next development indicator can appear in the screenshots; final production proof must have no development overlay.

Evidence:

- Original baseline: `/tmp/ysa-mobile-nav-contrast-before.log`, `/tmp/ysa-topbar-contrast-lENpyb/`.
- First repair / corner finding: `/tmp/ysa-mobile-nav-contrast-pass2.log`, `/tmp/ysa-topbar-contrast-lFLgfW/`.
- Final old-source rejection: `/tmp/ysa-mobile-nav-contrast-baseline-final.log`.
- Final local surface pass: `/tmp/ysa-mobile-nav-contrast-pass3.log`, `/tmp/ysa-topbar-contrast-KKpCUc/`.
- Actual navigation journeys: `/tmp/ysa-mobile-nav-journeys-pass3.log`, `/tmp/ysa-navigation-reflow-jsRNG3/`.

This is one shared-shell follow-up, not completion of the requested entire Studio redesign. Interior Library filter density, other pages/subpanels and real owner/publishing workflows remain separate work. No provider credit or GPU was used.
