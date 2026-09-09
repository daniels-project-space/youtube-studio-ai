# Shared navigation — scrolled-content contrast

## Defect and scope

Actual enlarged-phone Studio-assets screenshots exposed large page titles visibly painted through the navigation. The shared `.studio-topbar` used a 72%-opaque base and backdrop filtering. The source relationship is `AppShell` → `StudioLocation`, `ChannelSwitcher`, `OperationsAccess`; all operating pages share the affected CSS. Graphify was queried before the focused source review; Serena was unavailable. Installed Next CSS/accessibility guidance and owner-lock markers were checked before editing.

The fix retains the subtle cyan/violet gradient and edge but uses the existing opaque canvas token beneath it. Two unnecessary backdrop-filter declarations are removed. There is no new component, listener, observer, provider request, dependency, or change to channel/owner authority. This is a narrow shared-chrome repair, not completion of every page's design passes.

## Independent browser evidence

The proof opens actual public data on five routes at eight layout combinations, loads real channel options, scrolls actual headings under navigation, and captures viewport screenshots. It then compares header pixels with the genuine main content temporarily hidden; dimensions remain fixed and the main is restored immediately. It does not render substitute UI, inject owner access, or change production records. Header pixels are decoded with the browser's built-in PNG support, without adding an image library.

- The final unchanged-production baseline at `9ca4a62` fails **all eight cases**: between 3.24% and 36.96% of navigation pixels change when underlying page content is hidden. `/tmp/ysa-topbar-production-baseline-final.log`, `/tmp/ysa-topbar-contrast-n9PUQQ/`.
- The identical oracle against the changed local app passes **all eight cases with zero changed pixels**, zero horizontal overflow, zero browser errors and zero private-inventory requests. Real keyboard selector open/Escape/focus return also pass. `/tmp/ysa-topbar-local-final.log`, `/tmp/ysa-topbar-contrast-B7iMcm/`.
- Six full navigation journeys pass (`/tmp/ysa-topbar-nav-regression.log`, `/tmp/ysa-navigation-reflow-AmZ2OK/`). Five Studio-assets layouts retain fully exposed focused buttons (`/tmp/ysa-topbar-assets-regression.log`, `/tmp/ysa-studio-assets-live-4MFKlK/`). Desktop enlarged Golden and enlarged-phone asset screenshots were inspected.
- Local transport overrides forward only anonymous read-only session/asset/elevation GETs to production. No API fixture grants owner access. The eventual production proof must run without these overrides.

The oracle itself was corrected before drawing conclusions: short viewer pages cannot meaningfully exercise scrolling, so the ordinary-size cases use the real Library instead; named callbacks needed adjustment for the TS runner's browser serialization; the initial crop rounded a fractional header edge outward and counted one row of *outside* page pixels on tablet. The final crop uses inward integer boundaries and retains the same strict 0.1% tolerance. Older harness attempts are not visual-pass or release receipts.

The existing actual-navigation contract test additionally protects the opaque base token and removal of the filter. Its targeted run and scoped lint pass. Paid output and true owner OAuth remain unqualified by these read-only UI checks.

## Frozen release gate

Release **`c58adc6f6fedd564f5e7d59aff51decd4464cac6`** passed all **631 direct tests**, typecheck, zero-error lint (33 existing warnings), production build, unchanged audits, 24 defect proofs and real hermetic assembly with exit 0 in `/tmp/ysa-topbar-release-h9EnfC/repo`. Assembly: `/tmp/assembly-smoke-wp4WV7/bk_smoke_2_loudnorm.mp4`, 31.021995 seconds, 1920×1080. The frozen candidate's browser script independently repeated all eight cases successfully (`/tmp/ysa-topbar-frozen-browser.log`, `/tmp/ysa-topbar-contrast-Trk0Vm/`). Gate logs use `/tmp/ysa-topbar-release-` with tests, typecheck, lint, build, audit, defect-proof and assembly suffixes.

The ordinary fast-forward main release is verified on the exact Vercel alias at the full revision above. Vercel deployment: https://vercel.com/danielmabro-news-projects/youtube-studio-ai/52aQ8NapPA5wH64sbnFvEopYaFzc. Cloud workflow `34359472209` is still running at this report checkpoint; Convex/Trigger completion is not yet claimed.

Production exposed a test-readiness race: channel options arrived before the Library's actual video collection, so the original script stopped because the loading page was too short to scroll (`/tmp/ysa-topbar-production-c58adc6.log`). The proof now waits for the first actual `.video-grid .video-card` on that route. No application CSS, fixture, crop or threshold changed. The corrected proof passes all eight actual production cases with zero changed header pixels, no overflow/errors/private-inventory requests (`/tmp/ysa-topbar-production-c58adc6-ready.log`, `/tmp/ysa-topbar-contrast-GRvzEj/`). Six independent production navigation journeys also pass (`/tmp/ysa-topbar-nav-production-c58adc6.log`, `/tmp/ysa-navigation-reflow-rS3LnW/`). Enlarged-phone assets and enlarged-desktop Golden screenshots were inspected. This readiness-only harness correction is saved with the next scoped Lo-Fi release.

The separate [Lo-Fi reference review](LOFI_REFERENCE_LAYOUT_REVIEW_2026-09.md) follows this release. No reference manifest, model, sealed route or paid contract was changed by the top-bar slice.
