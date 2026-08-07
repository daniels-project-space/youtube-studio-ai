import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const wizard = readFileSync(join(root, "src/app/(app)/channels/new/page.tsx"), "utf8");
const detail = readFileSync(join(root, "src/app/(app)/channels/[slug]/page.tsx"), "utf8");
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

assert.doesNotMatch(sidebar, /health-dot-ready/);
assert.doesNotMatch(sidebar, /Live production workspace/);

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
