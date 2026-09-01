import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const wizard = readFileSync(join(root, "src/app/(app)/channels/new/page.tsx"), "utf8");
const wizardCss = readFileSync(join(root, "src/app/(app)/channels/new/newChannel.module.css"), "utf8");
const globalCss = readFileSync(join(root, "src/app/globals.css"), "utf8");
const overviewCss = readFileSync(join(root, "src/app/(app)/Overview.module.css"), "utf8");
const analyticsCss = readFileSync(join(root, "src/app/(app)/analytics/analytics.module.css"), "utf8");
const settingsCss = readFileSync(join(root, "src/app/(app)/settings/settings.module.css"), "utf8");
const artifactRailCss = readFileSync(join(root, "src/components/ArtifactWorkRail.module.css"), "utf8");
const detail = readFileSync(join(root, "src/app/(app)/channels/[slug]/page.tsx"), "utf8");
const channels = readFileSync(join(root, "src/app/(app)/channels/page.tsx"), "utf8");
const overview = readFileSync(join(root, "src/app/(app)/page.tsx"), "utf8");
const recentVideos = readFileSync(join(root, "src/components/RecentVideos.tsx"), "utf8");
const statusBanner = readFileSync(join(root, "src/components/StatusBanner.tsx"), "utf8");
const settings = readFileSync(join(root, "src/app/(app)/settings/page.tsx"), "utf8");
const sidebar = readFileSync(join(root, "src/components/Sidebar.tsx"), "utf8");
const scheduleCss = readFileSync(join(root, "src/app/(app)/schedule/schedule.module.css"), "utf8");
const designer = readFileSync(join(root, "src/engine/designer.ts"), "utf8");

const terminalError = wizard.match(/const terminalError = \(message: string\) => \{([\s\S]*?)\n    \};/)?.[1];
assert.ok(terminalError, "terminal build recovery handler must exist");
assert.doesNotMatch(terminalError, /removeItem\(ACTIVE_BUILD_STORAGE_KEY\)/);
assert.doesNotMatch(terminalError, /removeItem\(PENDING_BUILD_STORAGE_KEY\)/);
assert.doesNotMatch(terminalError, /submitPending|fetch\(/, "a blocker must not redispatch provider work");
assert.match(wizard, /href=\{`\/channels\/\$\{encodeURIComponent\(activeBuild\.slug\)\}`\}/);
assert.match(wizard, /The exact build identity is preserved/);
assert.match(detail, /className=\{styles\.inceptionStageError\}[\s\S]*role="alert"/);

// The no-Gemini policy must be legible in the creator itself: an optional
// reference URL is retained as operator context, never presented as a live
// automatic clip-analysis or style-copying capability.
assert.doesNotMatch(wizard, /\/api\/analyze-clip/);
assert.doesNotMatch(wizard, /Gemini analyzes|Gemini suggests/);
assert.match(wizard, /no automatic copying or clip analysis/);
assert.match(wizard, /deterministic advisor/);
assert.match(wizard, /Creator foundation: verified no-Gemini planning/);
assert.match(wizard, /preflight\.planning\.plannerBlock/);
assert.match(wizard, /preflight\.planning\.provenance/);

// Audience and sample episodes are decision-bearing creator input, not inert
// UI text. They must enter both the no-provider format request and the sealed
// ProgramBrief that the spend-capable route revalidates.
assert.match(wizard, /const \[audience, setAudience\] = useState\(""\)/);
assert.match(wizard, /const \[sampleTopicsText, setSampleTopicsText\] = useState\(""\)/);
assert.match(wizard, /\{ audience: audienceText \}/);
assert.match(wizard, /\{ sampleTopics \}/);
const programBriefArgs = wizard.match(/const programBrief = createChannelProgramBrief\(\{([\s\S]*?)\n      \}\);/)?.[1];
assert.ok(programBriefArgs, "the creator must construct a canonical ProgramBrief before request-key binding");
assert.match(programBriefArgs, /\{ audience: normalizedAudience \}/);
assert.match(programBriefArgs, /\{ sampleTopics \}/);
assert.match(programBriefArgs, /\{ programIntent \}/);
assert.match(programBriefArgs, /\{ serializedProgram \}/);
assert.match(wizard, /const serializedProgram = seriesTitle\.trim\(\)/);
assert.match(wizard, /version: SERIALIZED_PROGRAM_VERSION/);
assert.doesNotMatch(
  wizard,
  /seriesTitle: seriesTitle\.trim\(\) \|\| undefined/,
  "the browser must not send a top-level mutable series title beside the sealed ProgramBrief",
);
assert.doesNotMatch(
  wizard,
  /seriesCount: seriesTitle\.trim\(\) && seriesCount > 0 \? seriesCount : undefined/,
  "the browser must not send a top-level mutable series count beside the sealed ProgramBrief",
);
assert.match(wizard, /const programIntent = family === "quizyear"/);
assert.match(wizard, /kind: "sports_championship_timeline" as const/);
assert.match(wizard, /kind: "fictional_scenario" as const, profile: syntheticScenarioProfile/);
assert.doesNotMatch(wizard, /syntheticScenario: syntheticScenarioContract\(syntheticScenarioProfile\)/);
assert.doesNotMatch(wizard, /family === "quizyear" \? \{ quizProfile \} : \{\}/);
assert.match(wizard, /Sample episode ideas \(optional — one per line\)/);

// A selectable private-review intake is not an inactive automatic family
// pipeline in disguise. The creator must show only the registered review
// stages and withhold all production-module controls.
assert.match(wizard, /reviewOnlyStages: \[\.\.\.supervisedCapability\.coveredStages\]/);
assert.match(wizard, /reviewOnlyStages: \[\.\.\.\(preflight\.creatorAdmission\.coveredStages \?\? \[\]\)\]/);
assert.match(wizard, /supervisedAdmission \? activeReviewOnlyStages : preview/);
assert.match(wizard, /Only these private-review stages are active\. The family production pipeline is not enabled/);
assert.match(wizard, /Production module controls are unavailable/);
assert.match(wizard, /\{!supervisedAdmission && \(/);

// A source-attributed data story is review-first rather than automatic. Its
// explicit intake creates only a sealed draft shell and carries the exact mode
// into the normal recoverable request; it never inherits automatic creation.
assert.match(wizard, /Create reviewed Data Story intake/);
assert.match(wizard, /It creates only a sealed draft channel/);
assert.match(wizard, /supervisedDataStoryIntake: "reviewed_data_story_intake\/v1"/);
assert.match(wizard, /mode: "reviewed_data_story_intake\/v1"/);
assert.match(wizard, /function isAutomaticCapabilityOffer\(offer: CreativeCapabilityUiOffer\): boolean/);
assert.match(wizard, /offer\.capability !== "source_attributed_data_story"/);
assert.match(wizard, /\.\.\.automaticCapabilitySelections[\s\S]*source_attributed_data_story/);

// A renderer-ready family is not automatically creator-ready until the exact
// certified route, composition, inception, runtime, and release policy agree.
// The manual picker, niche shortcut, suggestion action, review step, and
// alternative cards must share that stronger projection rather than offering
// a route the server will subsequently refuse.
assert.match(wizard, /automaticFamilyCreatorReadiness/);
assert.doesNotMatch(wizard, /isFamilyProductionReady\(/);
assert.match(wizard, /Automatic creator admission is held/);
assert.match(wizard, /const liveRuntime = automaticFamilyRuntime\[next\]/);
assert.match(wizard, /live automatic foundation is unavailable/);
assert.match(wizard, /const \[automaticFamilyRuntimeCheck, setAutomaticFamilyRuntimeCheck\]/);
assert.match(wizard, /const selectedAutomaticRuntimeReady = Boolean\(/);
assert.match(wizard, /visibleAutomaticFamilyRuntimeCheck === "ready"/);
assert.match(wizard, /&& selectedAutomaticRuntimeReady/);
assert.match(wizard, /Automatic setup remains locked until this completes\./);
assert.match(wizard, /Live production readiness could not be verified\./);
// The readable creator shell must not probe an owner-only endpoint and emit a
// browser 401 before the signed owner session has been established.
assert.match(wizard, /const operationsAccess = useOperationsAccess\(\)/);
const ownerGuard = wizard.indexOf('if (operationsAccess !== "owner")');
const readinessFetch = wizard.indexOf('fetch("\/api\/automatic-family-readiness"');
assert.ok(ownerGuard >= 0, "the creator must gate owner-only readiness reads");
assert.ok(readinessFetch > ownerGuard, "the live readiness request must occur after the owner guard");
assert.match(wizard, /\}, \[operationsAccess\]\);/);

// Prose advice has no explicit creator length. It may use a researched niche
// default only when that niche's normal family is the exact suggested family;
// otherwise the suggested family owns its own duration contract.
assert.match(wizard, /const matchedNichePreset = niche\?\.defaultFamily === suggestedFamily/);
assert.match(wizard, /selectFamily\(suggestedFamily, matchedNichePreset\?\.targetSeconds\)/);
assert.match(wizard, /typeof d\.family !== "string" \|\| !\(d\.family in FAMILIES\)/);
assert.match(wizard, /const defaultFamilyReadiness = automaticFamilyCreatorReadiness\(n\.defaultFamily\)/);
assert.match(wizard, /"route ready" : "start held"/);
assert.match(wizard, />Held: \{defaultFamilyReadiness\.blockers\[0\]\}/);
assert.match(wizard, /defaultFamilyReadiness\.blockers\[0\]/);

// Channel creation is a staged operating workflow rather than a card wall.
// The foreground route, full catalog, advanced pipeline controls, and durable
// build receipts use explicit progressive disclosure without inventing media.
assert.match(wizard, /Build a channel system, not a profile/);
assert.match(wizard, /function NicheGlyph/);
assert.match(wizard, /<details className=\{styles\.routeCatalog\} open=\{!fam\}>/);
assert.match(wizard, /Pipeline style controls/);
assert.match(wizard, /showPipelineStyle && <div className=\{styles\.room\}><ModuleConfigSection/);
assert.match(wizard, /Receipt coverage/);
assert.match(wizard, /Private quality-control render/);
assert.match(wizard, /status signal · no preview frames yet/);
assert.match(wizard, /STAGE_DESCRIPTIONS/);
assert.match(wizard, /executionAuthorized \? "Authorized" : "Plan only"/);
assert.match(wizardCss, /\.nicheGrid/);
assert.match(wizardCss, /\.buildWorkspace/);
assert.match(wizardCss, /@media \(max-width: 680px\)/);
assert.match(wizardCss, /prefers-reduced-motion/);

// Creator choice must expose the family-specific, mechanics-only quality bar
// that production review will enforce. This is original craft calibration, not
// a visual/style clone or an audience-performance promise.
assert.match(wizard, /referenceQualityContractFor/);
assert.match(wizard, /Original mechanics calibrated from/);
assert.match(wizard, /never a style-copying instruction or a promise of another channel’s audience/);
assert.match(wizard, /No usable reference-quality calibration is registered/);

// Companion Shorts are the default growth layer for a newly created narrated
// channel, but the designer must derive only an eligible private-first child
// after the parent upload and skip formats without narration timing.
assert.match(wizard, /shorts:\s*true/);
assert.match(wizard, /Companion Short when eligible \(9:16, private\)/);
assert.match(designer, /if \(t\.shorts && opts\.family !== "music_loop"\)/);
assert.match(designer, /hasUpload && hasTimings/);
assert.match(designer, /block: "shorts_spinoff"/);
assert.match(designer, /before notify\/cleanup/);

// The server may identify a private desk on an intentional 409. Render only
// internal path-only destinations and require an explicit operator click;
// never redirect or replay the rejected request.
assert.match(wizard, /function safeReviewHrefs\(value: unknown\): string\[\]/);
assert.match(wizard, /const REVIEW_HREFS = new Set\(\["\/casefile", "\/editorial-evidence"\]\)/);
assert.match(wizard, /!REVIEW_HREFS\.has\(entry\)/);
assert.match(wizard, /setReviewHrefs\(res\.status === 409 \? safeReviewHrefs\(data\.reviewHrefs\) : \[\]\)/);
assert.match(wizard, /reviewHrefs\.map\(\(href\) => \(/);
assert.match(wizard, /<Link key=\{href\} href=\{href\} style=\{btnPrimary\}>/);
assert.doesNotMatch(wizard, /window\.location.*reviewHrefs|router\.push\(.*reviewHrefs/);

assert.doesNotMatch(sidebar, /health-dot-ready/);
assert.doesNotMatch(sidebar, /Live production workspace/);
// The rail keeps production primary and preserves packaging research in the
// disclosed specialist toolbox. Channel cards still own their guarded actions.
assert.match(sidebar, /href:\s*["']\/runs["']/);
assert.match(sidebar, /href:\s*["']\/seo["']/);
assert.match(sidebar, /const PRIMARY_NAV_ITEMS[\s\S]*href:\s*["']\/runs["']/);
assert.match(sidebar, /const TOOLBOX_NAV_GROUPS[\s\S]*href:\s*["']\/seo["']/);
assert.doesNotMatch(sidebar, /Novita Render/);
assert.match(sidebar, /MOBILE_PRIMARY_COUNT/);
assert.match(channels, /channel-live-state/);
assert.match(channels, /link\.status === "active"/);
assert.match(channels, /link\.scopeHealth === "healthy"/);
assert.match(channels, /OAuth scopes unverified/);
assert.match(channels, /\?tab=seo/);
assert.match(detail, /Refresh intelligence/);
// A connector with partial scopes is not a ready destination just because it
// has a token. The detail surface must use the same conservative state model
// as the channel list, preserve the manual profile-picture handoff, and never
// offer a second irreversible channel creation after a target is recorded.
assert.match(detail, /assessYouTubeSetup/);
assert.match(detail, /setup\.oauth === "ready"/);
assert.match(detail, /setup\.canAutoCreate/);
assert.match(detail, /Google does not provide this integration a reliable completion receipt/);
// Standalone channels are not synthetic multilingual groups. The advanced
// system also stays unmounted until opened so its voice catalog does not fetch
// dozens of hidden audition assets on every Settings visit.
assert.match(detail, /channel\.groupId \? \{ groupId: channel\.groupId \} : "skip"/);
assert.doesNotMatch(detail, /groupId:\s*channel\.groupId \?\? channel\._id/);
assert.match(detail, /const \[advancedOpen, setAdvancedOpen\] = useState\(false\)/);
assert.match(detail, /\{advancedOpen && \(/);
// A channel shelf reads both collections for truthful counts but only renders
// active masters; archived work remains recoverable from the full Library.
assert.match(detail, /includeArchived: true/);
assert.match(detail, /video\.libraryState !== "archived"/);
assert.match(detail, /Archived videos are hidden from this shelf without deleting/);
assert.match(detail, /Audience and unit economics/);
assert.match(detail, /Shape the queue before the render queue/);
assert.match(overview, /item\.status === "ready"/);
assert.doesNotMatch(overview, /need review/);
assert.match(overview, /<details className=\{`\$\{styles\.runsWidget\}/);
assert.match(statusBanner, /run\.channelSlug === channelSlug/);
assert.match(recentVideos, /Boolean\(video\.videoKey\)/);
assert.match(recentVideos, /R2VideoDialog/);
assert.doesNotMatch(recentVideos, /youtube\.com\/watch/);
assert.match(settings, /\/api\/channel-settings/);
assert.match(settings, /\/api\/youtube-revoke/);

// High-frequency navigation and channel-management actions must remain usable
// touch targets on both desktop and the mobile bottom-navigation layout.
assert.match(globalCss, /\.channel-card-title > a\s*\{[\s\S]*?min-height: 36px/);
assert.match(globalCss, /\.channel-card-secondary-actions a\s*\{[\s\S]*?min-height: 38px/);
assert.match(globalCss, /\.channel-account-action\s*\{[\s\S]*?min-height: 38px/);
assert.match(globalCss, /\.channel-card-actions a\s*\{[\s\S]*?min-height: 40px/);
assert.match(scheduleCss, /\.itemLinks a\s*\{[\s\S]*?min-height: 36px/);
assert.match(overviewCss, /\.sectionHeading > a,[\s\S]*?min-height: 36px/);
assert.match(analyticsCss, /\.healthCopy > a\s*\{[\s\S]*?min-height: 36px/);
assert.match(settingsCss, /\.lockedRoom > a\s*\{[\s\S]*?min-height: 36px/);
assert.match(artifactRailCss, /\.action > a,[\s\S]*?min-height: 36px/);

function remValue(selector: string, property: "font" | "font-size") {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = scheduleCss.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1];
  assert.ok(body, `missing CSS rule for ${selector}`);
  const value = body.match(new RegExp(`${property}\\s*:\\s*(0?\\.\\d+)rem`))?.[1];
  assert.ok(value, `missing rem ${property} for ${selector}`);
  return Number(value);
}

for (const [selector, property] of [
  [".dayColumnHeader span", "font-size"],
  [".dayColumnHeader small", "font"],
  [".dayEmpty", "font"],
  [".dayEventTime", "font"],
  [".dayEventCopy > strong", "font-size"],
  [".dayEventMeta > span:first-child", "font-size"],
] as const) {
  assert.ok(
    remValue(selector, property) >= 0.72,
    `${selector} must remain at least 0.72rem (11.52px at the 16px root)`,
  );
}

console.log("Studio UI recovery, health-truthfulness, and schedule readability contracts passed");
