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
assert.match(page, /aria-label="Render route policy"/);
assert.match(page, /medium first → high fallback/);
assert.match(page, /api\/minimax-h3\/\$\{mode\}/);
assert.match(page, /api\/minimax-h3\/status/);
assert.match(page, /data-capacity-mode=\{status\.receipt\.capacityMode\}/,
  "the render desk surfaces the admitted Salad tier from the durable receipt");
assert.match(page, /h3ProgressPercent\(status\)/,
  "the render desk progress bar must use durable receipt completion counts when available");
assert.match(page, /api\/minimax-h3\/capacity\?jobCount=/,
  "the render desk offers a read-only pre-dispatch Salad capacity check");
assert.match(page, /const checkCapacity = useCallback\(async \(\) =>/,
  "capacity probing must be stable so the auto-probe cannot loop on every render");
assert.match(page, /if \(access !== "owner" \|\| mode !== "weekly" \|\| !parsedPreview\.valid\) return;/,
  "automatic capacity probing must remain owner-scoped and only run for valid weekly work");
assert.match(page, /void checkCapacity\(\);/,
  "a valid weekly slate must automatically discover medium or high fallback admission");
assert.match(page, /Check Salad capacity/);
assert.match(page, /status\??\.state === "held"/);
assert.match(page, /Held before spend/);
assert.match(page, /medium first, then high only if it unlocks this wave/,
  "a capacity hold explains the authorized medium-to-high retry policy");
assert.match(page, /background recheck keeps the held desk useful/,
  "capacity-held runs should keep observing without implicitly spending");
assert.match(page, /window\.setTimeout\(poll, 60_000\)/,
  "held capacity polling must be deliberately bounded rather than a busy loop");
assert.match(page, /if \(body\.state === "admitted"\) return/,
  "an admitted capacity result stops the no-spend observer until explicit retry");
assert.match(page, /Could not refresh Salad capacity\. Retrying automatically in one minute\./,
  "a transient held-lane capacity refresh failure must remain visible without changing the held spend state");
assert.match(page, /capacityRefreshNotice/,
  "the capacity desk must retain its bounded polling failure as operator-visible state");
assert.match(page, /if \(!response\.ok \|\| !body \|\| !\("state" in body\)\)/,
  "malformed or non-OK held-lane capacity responses must be visible instead of silently retrying");
assert.match(page, /Retry with high priority/,
  "an admitted high-tier fallback must make the explicit paid action unambiguous");
assert.match(page, /Retry at HIGH priority\? This may cost more per GPU-hour/,
  "a held-run retry must confirm the higher-cost fallback before re-queueing paid work");
assert.match(page, /selectedPriceUsdPerHour\.toFixed\(3\)/,
  "the pre-spend admission result must show the hourly rate for the selected tier");
assert.match(page, /Fleet snapshot/);
assert.match(page, /api\/salad\/capacity/);
assert.match(page, /jobCount=\$\{requestedJobs\}/);
assert.match(page, /aria-label="Salad fleet snapshot"/);
assert.match(page, /fleetBlockerLabel/,
  "held fleet lanes must expose an actionable capacity reason rather than only a status token");
assert.match(page, /global_three_gpu_capacity_insufficient_for_wave/,
  "the render desk must explain when an existing lease leaves too few slots for the requested wave");
assert.match(page, /localStorage/);
assert.match(page, /H3_TRACKING_STORAGE_KEY/);
assert.match(page, /URLSearchParams\(window\.location\.search\)/,
  "the render desk accepts a deep link to the requested provider lane");
assert.match(page, /requestedMode === "weekly"/);
assert.match(page, /requestedMode === "on-demand"/);
assert.match(page, /validationIssues/, "invalid sealed jobs must expose actionable feedback before dispatch");
assert.match(page, /dispatchDisabledReason/, "the paid queue action must explain missing dispatch inputs before a click");
assert.match(page, /owner-scoped receipt key before queueing/, "the render desk must explain the receipt-key boundary");
assert.match(page, /aria-label=\{dispatchDisabledReason \? `\$\{provider\} render unavailable:/, "disabled paid controls must expose an actionable accessible reason");
assert.match(page, /Read current medium-first\/high-fallback capacity without starting a paid job/, "capacity checks must disclose that they are read-only");
assert.match(page, /Request packet invalid/, "a corrupt frozen weekly packet must be visible in progress");
assert.match(page, /window\.confirm/);
assert.match(route, /provider:\s*"salad"/);
assert.match(onDemand, /provider:\s*"novita"/);
assert.doesNotMatch(page, /MINIMAX_H3_.*TOKEN|R2_SECRET_ACCESS_KEY/);

console.log("MiniMax H3 render lane UI contracts passed");
