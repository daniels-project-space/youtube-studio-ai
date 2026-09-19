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
assert.match(page, /<details className=\{styles\.stageDetails\}>/u,
  "settled channel-creation receipts must remain available without permanently consuming the workspace");
assert.match(css, /\.buildHero \{ min-height: 132px;/u,
  "the build view must reserve its space for live work, not a decorative hero");

console.log("CHANNEL WIZARD UI PASS: mobile territory choices are visible without a hidden carousel");
