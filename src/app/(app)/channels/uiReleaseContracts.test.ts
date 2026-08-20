import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const wizard = readFileSync(join(root, "src/app/(app)/channels/new/page.tsx"), "utf8");
const detail = readFileSync(join(root, "src/app/(app)/channels/[slug]/page.tsx"), "utf8");
const channels = readFileSync(join(root, "src/app/(app)/channels/page.tsx"), "utf8");
const overview = readFileSync(join(root, "src/app/(app)/page.tsx"), "utf8");
const recentVideos = readFileSync(join(root, "src/components/RecentVideos.tsx"), "utf8");
const statusBanner = readFileSync(join(root, "src/components/StatusBanner.tsx"), "utf8");
const settings = readFileSync(join(root, "src/app/(app)/settings/page.tsx"), "utf8");
const sidebar = readFileSync(join(root, "src/components/Sidebar.tsx"), "utf8");
const scheduleCss = readFileSync(join(root, "src/app/(app)/schedule/schedule.module.css"), "utf8");

const terminalError = wizard.match(/const terminalError = \(message: string\) => \{([\s\S]*?)\n    \};/)?.[1];
assert.ok(terminalError, "terminal build recovery handler must exist");
assert.doesNotMatch(terminalError, /removeItem\(ACTIVE_BUILD_STORAGE_KEY\)/);
assert.doesNotMatch(terminalError, /removeItem\(PENDING_BUILD_STORAGE_KEY\)/);
assert.doesNotMatch(terminalError, /submitPending|fetch\(/, "a blocker must not redispatch provider work");
assert.match(wizard, /href=\{`\/channels\/\$\{encodeURIComponent\(activeBuild\.slug\)\}`\}/);
assert.match(wizard, /The exact build identity is preserved/);
assert.match(detail, /channel-inception-stage-error[\s\S]*role="alert"/);

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

// A selectable private-review intake is not an inactive automatic family
// pipeline in disguise. The creator must show only the registered review
// stages and withhold all production-module controls.
assert.match(wizard, /reviewOnlyStages: \[\.\.\.supervisedCapability\.coveredStages\]/);
assert.match(wizard, /reviewOnlyStages: \[\.\.\.\(preflight\.creatorAdmission\.coveredStages \?\? \[\]\)\]/);
assert.match(wizard, /supervisedAdmission \? activeReviewOnlyStages : preview/);
assert.match(wizard, /Only these private-review stages are active\. The family production pipeline is not enabled/);
assert.match(wizard, /Production module controls are unavailable/);
assert.match(wizard, /\{!supervisedAdmission && \(/);

assert.doesNotMatch(sidebar, /health-dot-ready/);
assert.doesNotMatch(sidebar, /Live production workspace/);
assert.doesNotMatch(sidebar, /href:\s*["']\/runs["']/);
assert.doesNotMatch(sidebar, /href:\s*["']\/seo["']/);
assert.doesNotMatch(sidebar, /Novita Render/);
assert.match(sidebar, /MOBILE_PRIMARY_COUNT/);
assert.match(channels, /channel-live-state/);
assert.match(channels, /link\.status === "active"/);
assert.match(channels, /link\.scopeHealth !== "partial"/);
assert.match(channels, /\?tab=seo/);
assert.match(detail, /Refresh intelligence/);
assert.match(overview, /item\.status === "ready"/);
assert.doesNotMatch(overview, /need review/);
assert.match(overview, /<details className=\{`\$\{styles\.runsWidget\}/);
assert.match(statusBanner, /run\.channelSlug === channelSlug/);
assert.match(recentVideos, /Boolean\(video\.videoKey\)/);
assert.match(recentVideos, /R2VideoDialog/);
assert.doesNotMatch(recentVideos, /youtube\.com\/watch/);
assert.match(settings, /\/api\/channel-settings/);
assert.match(settings, /\/api\/youtube-revoke/);

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
  [".dayEmpty", "font-size"],
  [".dayEventTime", "font"],
  [".dayEvent > strong", "font-size"],
  [".dayEventMeta > span:first-child", "font-size"],
] as const) {
  assert.ok(
    remValue(selector, property) >= 0.72,
    `${selector} must remain at least 0.72rem (11.52px at the 16px root)`,
  );
}

console.log("Studio UI recovery, health-truthfulness, and schedule readability contracts passed");
