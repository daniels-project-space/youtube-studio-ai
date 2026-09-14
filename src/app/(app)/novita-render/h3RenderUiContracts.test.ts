import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const page = readFileSync(`${here}/H3RenderConsole.tsx`, "utf8");
const route = readFileSync(`${here}/../../api/minimax-h3/weekly/route.ts`, "utf8");
const onDemand = readFileSync(`${here}/../../api/minimax-h3/on-demand/route.ts`, "utf8");

assert.match(page, /Weekly batch/);
assert.match(page, /Salad/);
assert.match(page, /On demand/);
assert.match(page, /Novita/);
assert.match(page, /api\/minimax-h3\/\$\{mode\}/);
assert.match(page, /api\/minimax-h3\/status/);
assert.match(page, /data-capacity-mode=\{status\.receipt\.capacityMode\}/,
  "the render desk surfaces the admitted Salad tier from the durable receipt");
assert.match(page, /api\/minimax-h3\/capacity\?jobCount=/,
  "the render desk offers a read-only pre-dispatch Salad capacity check");
assert.match(page, /Check Salad capacity/);
assert.match(page, /status\.state === "held"/);
assert.match(page, /Held before spend/);
assert.match(page, /Fleet snapshot/);
assert.match(page, /api\/salad\/capacity/);
assert.match(page, /jobCount=\$\{requestedJobs\}/);
assert.match(page, /aria-label="Salad fleet snapshot"/);
assert.match(page, /localStorage/);
assert.match(page, /H3_TRACKING_STORAGE_KEY/);
assert.match(page, /URLSearchParams\(window\.location\.search\)/,
  "the render desk accepts a deep link to the requested provider lane");
assert.match(page, /requestedMode === "weekly"/);
assert.match(page, /requestedMode === "on-demand"/);
assert.match(page, /validationIssues/, "invalid sealed jobs must expose actionable feedback before dispatch");
assert.match(page, /Request packet invalid/, "a corrupt frozen weekly packet must be visible in progress");
assert.match(page, /window\.confirm/);
assert.match(route, /provider:\s*"salad"/);
assert.match(onDemand, /provider:\s*"novita"/);
assert.doesNotMatch(page, /MINIMAX_H3_.*TOKEN|R2_SECRET_ACCESS_KEY/);

console.log("MiniMax H3 render lane UI contracts passed");
