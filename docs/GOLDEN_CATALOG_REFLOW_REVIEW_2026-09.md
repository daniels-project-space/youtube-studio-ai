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

## Stronger gate result

Pass 3 reported 36 collapsed-heading failures caused by measuring font-ink overflow as clipping even where CSS allowed it to remain visible (`/tmp/ysa-golden-layout-pass3.log`). The final oracle distinguishes visible line-box overhang from actual hidden/clipped content and checks text against its containing summary. A separate diagnostic without the public-viewer proxy could not hydrate; it was not counted as application evidence.

With that corrected oracle, unchanged production fails **227 checks** (`/tmp/ysa-golden-layout-strong-baseline2.log`, `/tmp/ysa-golden-layout-H5H1v0/`), while the actual local app passes all five layouts, **280 collapsed/opened card pairs**, all toolbar focus/hit/target-size checks, unchanged counts and one peak lock subscription, with no browser errors (`/tmp/ysa-golden-layout-pass4.log`, `/tmp/ysa-golden-layout-NJ0zzZ/`). Desktop catalog, phone-200% Topic Intel and desktop Voicecraft screenshots were inspected. Owner locks were focused, never toggled; media playback and all destination pages are not claimed by this card-layout test.

Frozen release candidate `56be19f7720b002949e180747a5a25b4898032c9` contains only the Golden CSS, its card proof and UI reports. Source and proof match the passing fourth pass byte-for-byte. Full tests/assembly, typecheck/lint/build and audits/defect proofs run in `/tmp/ysa-golden-release-s2skBd/repo`; logs are `/tmp/ysa-golden-release-tests.log`, `/tmp/ysa-golden-release-typecheck.log`, `/tmp/ysa-golden-release-lint.log`, `/tmp/ysa-golden-release-build.log`, `/tmp/ysa-golden-release-audit-corrected.log` and `/tmp/ysa-golden-release-defect-proof.log`. The first audit launch used an absent script filename and did not run; the corrected invocation uses the existing `npm run audit` without changing any baseline.

`scripts/golden-evidence-browser-proof.mts` is a **separate follow-up audit**, outside that frozen candidate, for both assurance panels and their nested disclosures. Its results are not folded into the passing card claim. The remaining goal continues while paid infrastructure or credits are unavailable.

## Completed local release gate

Candidate `56be19f` passed all **631 direct readiness tests**, typecheck, production build, zero-error lint (33 existing warnings), unchanged structural audits and all 24 defect-baseline proofs. The full suite's `&&` chain reached and passed the real 31.021995-second 1920×1080 assembly (`/tmp/assembly-smoke-1VUxv9/bk_smoke_2_loudnorm.mp4`). Its outer session reported exit 143 after the success output, so a clean combined-shell exit is **not** claimed. The unchanged assembly command was separately rerun to clean **exit 0** (`/tmp/ysa-golden-release-assembly-confirmation.log`, `/tmp/assembly-smoke-oYPhGt/bk_smoke_2_loudnorm.mp4`). No exit override or test code change was used. This distinguishes command termination from the actual completed child-test results. Production provider, exact-alias and browser checks are still required after pushing this candidate.

## Production card verification

[Vercel reports success](https://vercel.com/danielmabro-news-projects/youtube-studio-ai/5WiWE9xArDz8G7zx8spQ33cnNgjM), and the exact production `/api/health` returned full `56be19f7720b002949e180747a5a25b4898032c9`. The unmodified candidate's production-mode browser audit passed all five layouts, all 280 collapsed/opened card pairs, actual toolbar focus/center hit/44 px checks and one shared lock subscription, with no page errors or endpoint overrides (`/tmp/ysa-golden-production-56be19f.log`, `/tmp/ysa-golden-layout-7ClEQ8/`). Desktop catalog and phone-200% Topic Intel screenshots were visually inspected. [Cloud CI 34350598740](https://github.com/daniels-project-space/youtube-studio-ai/actions/runs/34350598740) is still running; its completion is not yet claimed.

A separate production journey audit follows the actual catalog links to all seven destinations and returns to Golden on desktop and phone: 14 successful journeys, no page errors or horizontal overflow (`/tmp/ysa-golden-destinations-baseline.log`, `/tmp/ysa-golden-destinations-BRqyRH/`). It checks navigation and real page headings, **not** tool jobs or owner operations. Studio assets remains owner-restricted; its displayed zero counts are not evidence of an empty registry. Studio-assets desktop and SEO phone screenshots exposed further oversized decoration/small-text concerns for the ongoing all-page work. No owner action was taken.

Cloud CI `34350598740` subsequently completed: canonical Convex ready **12:33:03 UTC**, Trigger **20260909.12** deployed **12:35:02 UTC**, worker `worker_cmtu2z6hr597x0vln4l9ou26u`, backend content hash `101fa3a5b4b7ad6781cca1df216d69e9` (`/tmp/ysa-golden-cloud-deploy.log`). The separate evidence-panel successor `aa96282` is now also production-verified, including another complete card regression; see its own release report.
