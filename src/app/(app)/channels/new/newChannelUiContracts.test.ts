import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const page = readFileSync(join(root, "src/app/(app)/channels/new/page.tsx"), "utf8");
const css = readFileSync(join(root, "src/app/(app)/channels/new/newChannel.module.css"), "utf8");
const mobileStyles = css.split("@media (max-width: 680px) {")[1]?.split("@media (max-width: 430px) {")[0];

assert.ok(mobileStyles, "the channel wizard needs a mobile layout");
assert.match(mobileStyles, /\.nicheGrid\s*\{\s*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\);\s*\}/u,
  "featured territories must be discoverable without horizontal scrolling on mobile");
assert.doesNotMatch(mobileStyles, /\.nicheGrid\s*\{[^}]*overflow-x:\s*auto/u);
assert.match(css, /@media \(max-width: 350px\)\s*\{\s*\.nicheGrid\s*\{\s*grid-template-columns:\s*1fr;/u,
  "very narrow phones need readable full-width territory names");
assert.match(page, /visibleNiches\.map\(\(n\) =>/u, "all featured territory choices must remain selectable");
assert.match(page, /aria-pressed=\{on\}/u, "the selected territory must remain accessible");
assert.match(page, /hiddenNicheCount > 0/u, "the full territory catalog must remain one action away");
assert.match(page, /function creatorReadinessSummary\(/u,
  "creator holds need a concise user-facing admission explanation");
assert.match(page, /H3 visual worker needs activation\./u);
assert.match(page, /setClipNote\(null\);\s*setFamily\(next\);/u,
  "a newly admitted route must clear stale route warnings instead of repeating old status beneath valid controls");
assert.doesNotMatch(page, /nicheBlocker\}>Held: \{defaultFamilyReadiness\.blockers\[0\]\}/u,
  "the initial territory grid must not expose raw worker/environment variable names");
assert.match(page, /const attentionStages = stageRows\.filter/u,
  "live channel creation must foreground only active or actionable stages");
assert.match(page, /Private validation output is ready to review\. It remains unpublished; publishing and scheduling are disabled\./u,
  "a completed probe must be described as private and unpublished");
assert.match(page, /Channel setup is complete, but no video has been generated yet\. Run private validation to create one; publishing and scheduling are disabled\./u,
  "a setup-only receipt must not be mistaken for a video output");
assert.doesNotMatch(page, /Thumbnail generation is deferred, so external publishing stays blocked\./u,
  "channel-level thumbnail deferral must not be confused with the probe video’s graded thumbnail");
assert.match(page, /probeOutputReady = progress\.stages\.some\(\(stage\) =>[\s\S]*moduleKey === "channel-inception-probe"[\s\S]*status === "complete" \|\| stage\.status === "accepted"/u,
  "the completion route must be based on a successful private probe receipt");
assert.match(page, /router\.push\(probeOutputReady[\s\S]*\?tab=library/u,
  "a completed private probe must open the channel Library so its real video artifact is immediately reviewable");
assert.match(page, /<details className=\{styles\.stageDetails\}>/u,
  "settled channel-creation receipts must remain available without permanently consuming the workspace");
assert.match(css, /\.buildHero \{ min-height: 132px;/u,
  "the build view must reserve its space for live work, not a decorative hero");

console.log("CHANNEL WIZARD UI PASS: mobile territory choices are visible without a hidden carousel");
