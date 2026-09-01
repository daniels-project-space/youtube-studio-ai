import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const page = readFileSync(`${here}/page.tsx`, "utf8");
const styles = readFileSync(`${here}/novita-render.module.css`, "utf8");

assert.match(page, /Compute stage · signed render control/i);
assert.match(page, /Inspect first\. Confirm spend second\. Dispatch last\./);
assert.match(page, /function RenderFleetHero/);
assert.match(page, /function AdmissionTrace/);
assert.match(page, /function RenderProgressTheatre/);
assert.match(page, /Live render progress/);
assert.match(page, /status: status\.status/);
assert.match(page, /outputs: status\.n_outputs/);
assert.match(page, /total: status\.n_jobs/);
assert.match(page, /progress\?\.jobId/);
assert.match(page, /function LockedRenderConsole/);
assert.match(page, /No private fleet, job, prompt, or provider request was sent/);
assert.match(page, /Nothing launches without your confirmation\./);
assert.match(page, /window\.confirm\(/);
assert.doesNotMatch(page, /<PageHeader/);
assert.doesNotMatch(page, /<OwnerOnlyNotice/);
assert.doesNotMatch(page, /style=\{\{(?! width:)/,
  "only the live progress meter may keep a dynamic inline width");

assert.match(styles, /\.fleetField/);
assert.match(styles, /\.progressStages/);
assert.match(styles, /\.outputSlots/);
assert.match(styles, /\.workstation/);
assert.match(styles, /\.launchDock/);
assert.match(styles, /@keyframes statusPulse/);
assert.match(styles, /prefers-reduced-motion: reduce/);
assert.match(styles, /@media \(max-width: 540px\)/);

console.log("Novita render UI contracts passed");
