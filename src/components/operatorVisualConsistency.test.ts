import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const pageHeader = read("src/components/PageHeader.tsx");
const appShell = read("src/components/AppShell.tsx");
const runCard = read("src/components/RunCard.tsx");
const videoCard = read("src/components/VideoCard.tsx");
const lightbox = read("src/components/Lightbox.tsx");
const videoPlayer = read("src/components/VideoPlayer.tsx");
const libraryFilters = read("src/components/LibraryFilters.tsx");
const library = read("src/app/(app)/library/page.tsx");
const runs = read("src/app/(app)/runs/page.tsx");
const runsModel = read("src/app/(app)/runs/runsModel.ts");
const runsCss = read("src/app/(app)/runs/runs.module.css");
const schedule = read("src/app/(app)/schedule/DayByDaySchedule.tsx");
const globalCss = read("src/app/globals.css");
const mediaPreview = read("src/components/MediaPreview.tsx");
const sidebar = read("src/components/Sidebar.tsx");
const livePipeline = read("src/components/LivePipeline.tsx");
const livePipelineCss = read("src/components/LivePipeline.module.css");
const runDetail = read("src/app/(app)/runs/[runId]/page.tsx");
const runDetailCss = read("src/app/(app)/runs/[runId]/runDetail.module.css");
const logConsole = read("src/components/LogConsole.tsx");
const logConsoleCss = read("src/components/LogConsole.module.css");
const releaseEvidenceBadge = read("src/components/ReleaseEvidenceBadge.tsx");

// A shared header is the visual anchor for the main operator pages. Its action
// state must be structural, not a page-specific style hack.
assert.match(pageHeader, /<header[\s\S]*data-has-actions=/);
assert.match(pageHeader, /className="page-header-copy"/);
assert.match(appShell, /className="studio-mobile-brand"/);
assert.doesNotMatch(appShell, /className="studio-mobile-brand"\s+aria-label=/);

// Run controls deliberately filter the persisted query result; the summary is
// an accessible control surface rather than a decorative set of counts.
assert.match(runs, /api\.runs\.listRecent/);
assert.match(runs, /projectRunHistory/);
assert.match(runs, /aria-label="Filter runs by status"/);
assert.match(runs, /aria-pressed=\{filter === status\}/);
assert.match(runs, /data-status=\{status\}/);
assert.match(runsModel, /export const INITIAL_VISIBLE_RUNS = 12/);
assert.match(runsModel, /export function diagnoseRunFailure/);
assert.match(runs, /className=\{styles\.runFailure\}/);
assert.match(runsCss, /\.runFailure b/);
assert.match(runsModel, /matching\.slice\(0, safeLimit\)/);
assert.match(runs, /Showing \{projection\.visible\.length\} of \{projection\.matching\.length\}/);
assert.match(runs, /Load \{Math\.min\(INITIAL_VISIBLE_RUNS, projection\.remaining\)\}/);
assert.match(runsCss, /grid-template-columns: repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
assert.match(runsCss, /@media \(max-width: 820px\)/);

// The Library’s count derives from its actual filtered rows, never an invented
// activity metric, and the toolbar keeps explicit labels for every control.
assert.match(library, /resultCount=\{filtered\.length\}/);
assert.match(libraryFilters, /aria-label="Library filters"/);
assert.match(libraryFilters, /<strong>\{resultCount\}<\/strong>/);
for (const id of ["library-search", "library-channel", "library-status", "library-sort", "library-from", "library-to"]) {
  assert.match(libraryFilters, new RegExp(`htmlFor="${id}"`));
  assert.match(libraryFilters, new RegExp(`id="${id}"`));
}
assert.match(globalCss, /--color-failed: #fb7185/);
assert.doesNotMatch(globalCss, /\.channel-live-state-inactive\s*\{\s*opacity:/);
assert.match(globalCss, /\.channel-live-state small[\s\S]*display: none/);
assert.match(globalCss, /@media \(max-width: 520px\)[\s\S]*\.channel-live-state small \{ display: block/);
assert.match(globalCss, /\.channel-card-grid[\s\S]*min\(100%, 340px\)/);
assert.match(globalCss, /\.channel-card-readiness progress/);
assert.match(globalCss, /@media \(max-width: 520px\)[\s\S]*\.channel-live-state[\s\S]*grid-column: 1 \/ -1/);

// Visual review always uses a persisted R2 thumbnail first. The shared media
// boundary holds a stable space while R2 resolves and only falls back to a
// genuine YouTube thumbnail after the retained preview failed.
for (const source of [videoCard, schedule]) {
  assert.match(source, /MediaPreview/);
  assert.match(source, /fallbackSource="youtube"/);
}
assert.match(mediaPreview, /useAssetUrlState/);
assert.match(mediaPreview, /data-preview-source=/);
assert.match(mediaPreview, /decoding="async"/);

assert.match(runCard, /data-status=\{run\.status\}/);
assert.match(runCard, /data-release-evidence=\{run\.releaseEvidenceStatus\}/);
assert.match(globalCss, /\.run-card\[data-status="running"\]/);
assert.match(globalCss, /\.video-card-media::after/);

// Everyday work stays in one six-item rail. Specialist destinations remain
// reachable behind one native disclosure, while four actions form the dock.
for (const route of ["/runs", "/schedule", "/library", "/analytics", "/seo", "/editorial-evidence", "/casefile", "/studio-assets", "/golden", "/novita-render"]) {
  assert.match(sidebar, new RegExp(`href: \\"${route.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}\\"`));
}
assert.match(sidebar, /const PRIMARY_NAV_ITEMS = \[[\s\S]*href: "\/runs"[\s\S]*href: "\/schedule"[\s\S]*href: "\/analytics"/);
assert.match(sidebar, /const TOOLBOX_NAV_GROUPS = \[/);
assert.match(sidebar, /<details[\s\S]*className="studio-toolbox"/);
assert.match(sidebar, /const MOBILE_PRIMARY_COUNT = 4/);
assert.match(sidebar, /const MOBILE_CORE_ITEMS = PRIMARY_NAV_ITEMS\.slice\(MOBILE_PRIMARY_COUNT\)/);
assert.match(sidebar, /className="studio-toolbox studio-mobile-toolbox"/);
assert.match(sidebar, /MOBILE_CORE_ITEMS\.map/);
assert.doesNotMatch(sidebar, /MOBILE_MORE_ITEMS\.map/);
assert.match(globalCss, /\.studio-mobile-toolbox-trigger/);
assert.match(globalCss, /iframe\[title="JARVIS"\][\s\S]*bottom: calc\(81px/);
assert.match(globalCss, /data-studio-more-open="true"[\s\S]*iframe\[title="JARVIS"\]/);
assert.match(globalCss, /:has\(\[role="dialog"\]\[aria-modal="true"\]\)[\s\S]*iframe\[title="JARVIS"\]/);
assert.match(globalCss, /:has\(\.owner-only-notice:not\(\[data-access-state="checking"\]\)\)[\s\S]*iframe\[title="JARVIS"\]/);

// Live work is a receipt-backed workbench: it groups real stages into phases,
// retains per-stage inspection, and does not suggest an invented render stream.
assert.match(livePipeline, /Run route monitor/);
assert.match(livePipeline, /summarizeLivePipelinePhases/);
assert.match(livePipeline, /<StageRow inputs=\{stage\.inputs\} outputs=\{stage\.outputs\} error=\{stage\.error\}/);
assert.match(livePipeline, /data-status=\{status\}/);
assert.match(livePipeline, /receiptPercent/);
assert.match(livePipeline, /persisted stage receipts/);
assert.doesNotMatch(livePipeline, /render stream/i);
assert.match(livePipelineCss, /\.phaseStrip/);
assert.match(livePipelineCss, /\.receiptMeter/);
assert.match(livePipelineCss, /prefers-reduced-motion/);
assert.match(livePipelineCss, /\.stageToggle/);
assert.match(livePipelineCss, /@media \(max-width: 520px\)/);

// A run is an inspectable production record, not just a log. The detail view
// keeps its summary, release evidence, retained media, phase workbench, and
// console in one responsive workspace backed by the persisted run queries.
assert.match(runDetail, /RunMediaWorkbench/);
assert.match(runDetail, /<LivePipeline nodes=\{nodes\}/);
assert.match(runDetail, /<LogConsole runId=\{run\._id\}/);
assert.match(runDetail, /styles\.summaryGrid/);
assert.match(runDetail, /data-run-status=\{run\.status\}/);
assert.match(runDetail, /publishedOpen && <div className=\{styles\.publishedFrame\}/);
assert.match(runDetail, /onToggle=\{\(event\) => setPublishedOpen\(event\.currentTarget\.open\)\}/);
assert.match(runDetail, /ReleaseEvidenceBadge status=\{run\.releaseEvidenceStatus\} compact/);
assert.match(runDetailCss, /grid-template-columns: repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
assert.match(runDetailCss, /@media \(max-width: 540px\)/);

// The terminal is a reviewable persisted record, not a decorative code box:
// operators can pause tail-following, jump back to the newest receipt, and
// distinguish a live run from a completed ledger without losing line counts.
assert.match(logConsole, /runStatus === "running" \|\| runStatus === "queued"/);
assert.match(logConsole, /Review paused/);
assert.match(logConsole, /Jump to latest/);
assert.match(logConsole, /scrollHeight - el\.scrollTop - el\.clientHeight < 40/);
assert.match(logConsoleCss, /\.line\s*\{/);
assert.match(logConsoleCss, /@media \(max-width: 680px\)/);
assert.match(releaseEvidenceBadge, /compact\?: boolean/);
assert.match(releaseEvidenceBadge, /Legacy unverified/);

// Opening a retained artifact is an operator action, so the Library dialog
// must behave like a real modal rather than strand keyboard focus behind it.
assert.match(lightbox, /aria-modal="true"/);
assert.match(lightbox, /aria-labelledby=\{titleId\}/);
assert.match(lightbox, /closeRef\.current\?\.focus\(\)/);
assert.match(lightbox, /openerRef\.current\?\.focus\(\)/);
assert.match(lightbox, /if \(e\.key !== "Tab"\) return/);
assert.match(lightbox, /<VideoPlayer video=\{video\} embedTabIndex=\{-1\}/);
assert.match(lightbox, /Watch on YouTube/);
assert.match(videoPlayer, /tabIndex=\{embedTabIndex\}/);

console.log("Operator visual consistency contracts passed");
