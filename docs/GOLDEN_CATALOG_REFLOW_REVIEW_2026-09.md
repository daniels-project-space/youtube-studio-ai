# Golden catalog — readable cards and controls

## Baseline and scope

The actual production catalog has 56 module cards, 37 pipeline bindings, 39 reference candidates and **zero promoted proofs**. Those counts are unchanged by this layout repair; reference samples are not being presented as qualified outputs. No module configuration, thumbnail renderer, lock handler, provider or paid route is changed.

The first browser audit (`/tmp/ysa-golden-layout-baseline.log`, `/tmp/ysa-golden-layout-x8PjZX/`) visited every card across five viewport/text-size cases. It failed 59 checks: header counts collided at desktop 200%, tablet and phone 200%, while all 56 expanded phone-200% cards clipped their content or protection region. Inspected screenshots show the collision, abbreviated pitches and a lock button covering its explanatory label.

## Root repair

- The compact count strip places values below readable labels. Its header wraps naturally; narrow effective widths use two columns without shrinking text.
- Card grids fit their actual available width, not a fixed 430 px minimum. Short pitches and bullets wrap completely instead of ending in ellipses.
- Narrow cards place their pitch and bullet points below the image/title row. Wide cards retain the compact side-by-side presentation.
- Protection information and its existing owner button have separate space at narrow widths; toolbar targets are at least 44 px high. No portal, layout polling, extra query or client component is introduced.
- Category headings and evidence grids reflow with the panel. The [CSS container-query approach](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries) responds to the panel width, including space taken by the navigation rail and enlarged text.

Graphify traced the existing `HeroMetric` and `ModuleCard` implementations and their binding/pitch callers. Source inspection confirmed that OwnerLockBadge already shares one deduplicated Convex lock-list query across the catalog. There is **no invented 56-to-1 query saving** in this change.

## Iteration and validation

Pass 1's visual changes repaired count overlap, but its audit incorrectly treated development remount query additions as simultaneous subscriptions. It recorded two lifecycle additions and failed; this is retained at `/tmp/ysa-golden-layout-pass1.log`, not called successful. The harness now tracks active query IDs through Add/Remove messages per connection, never auth payloads or query arguments. Pass 2 (`/tmp/ysa-golden-layout-pass2.log`, `/tmp/ysa-golden-layout-jYwaSf/`) passed five cases, all 280 real card expansions, and one peak lock subscription. Desktop-200% and phone screenshots were inspected.

A stronger third pass adds complete **collapsed** copy checks, keyboard focus and visible center hit-tests for every existing toolbar control, and 44 px minimum targets. It also captures the real viewport below the real sticky header instead of misleading full-element screenshots with fixed chrome composited over them. The same stronger audit is being run against unchanged production to demonstrate that it rejects the old layout.

This document does not yet claim that the third pass, full isolated release gate or production verification passed. It is a layout/interaction qualification, not a new module-output benchmark, all-browser certification or completion of the broader goal. Paid route qualification and every other retained requirement continue separately.
