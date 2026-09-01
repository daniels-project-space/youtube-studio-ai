import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const page = readFileSync(join(root, "src/app/(app)/page.tsx"), "utf8");
const css = readFileSync(join(root, "src/app/(app)/Overview.module.css"), "utf8");

assert.match(page, /buildStudioOverview\(\{/,
  "Studio must derive every top-level count and action from the tested overview model");
assert.match(page, /planWorkspaceHref\(item\)/,
  "upcoming release rows must open their exact channel plan item");
assert.match(page, /overview\.issues\.filter/,
  "issue details must reduce repetitive sources without falsifying the total");
assert.match(page, /<details className=\{`\$\{styles\.dataWidget\} \$\{styles\.issueWidget\}/,
  "issues must be an expandable widget");
assert.match(page, /<details className=\{`\$\{styles\.dataWidget\} \$\{styles\.analyticsWidget\}/,
  "analytics must be an expandable widget");
for (const href of ["/runs", "/schedule", "/channels", "/library", "/analytics", "/channels/new"]) {
  assert.match(page, new RegExp(`href=\\"${href.replace("/", "\\/")}\\"`),
    `master control ${href} must remain a real route`);
}
assert.match(page, /<svg viewBox="0 0 640 150"/,
  "the production map must remain a custom vector signal, not decorative stock media");
assert.match(css, /\.mapGraphic\[data-live="true"\] \.mapLine \{ animation:/,
  "live production must visibly animate the map");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.mapLine,[\s\S]*animation: none !important/,
  "the animated command canvas must honor reduced motion");
assert.match(css, /\.relayTrack \{[^}]*animation: relay-move 240s linear infinite/,
  "the channel relay must move slowly enough to remain readable");
assert.match(css, /\.dataWidget > header > a \{ width: 44px; height: 44px; \}/,
  "mobile widget actions must keep a 44px touch target");

console.log("Studio command-center UI contracts passed");
