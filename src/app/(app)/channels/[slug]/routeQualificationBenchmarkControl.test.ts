import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(
  resolve(process.cwd(), "src/app/(app)/channels/[slug]/page.tsx"),
  "utf8",
);
const endpoint = readFileSync(
  resolve(process.cwd(), "src/app/api/route-qualification-benchmarks/route.ts"),
  "utf8",
);

assert.match(
  page,
  /function SettingsTab[\s\S]*<RouteQualificationBenchmarkCard channel=\{channel\}/,
  "qualification controls belong in channel settings, not cadence or automatic creator flow",
);
assert.match(
  page,
  /Run a private final-master qualification benchmark[\s\S]*It will not upload or publish anything/,
  "the operator receives the private/no-publish consequence before confirmation",
);
assert.match(
  page,
  /requestKeyRef\.current \?\? window\.crypto\.randomUUID\(\)[\s\S]*requestKeyRef\.current = requestKey[\s\S]*requestKey,[\s\S]*confirmPrivateBenchmark: true/,
  "network retries reuse one owner-confirmed request key instead of allocating a second benchmark",
);
assert.match(
  page,
  /routeQualificationBenchmarkDispatchState[\s\S]*PRIVATE BENCHMARK STATUS[\s\S]*Open latest private benchmark/,
  "Settings renders persisted benchmark progress after the page is refreshed",
);
assert.doesNotMatch(page, /pipelineOverride:\s*channel|prompt:\s*channel/i,
  "the UI never supplies route execution inputs from browser state");
assert.match(
  endpoint,
  /action: "route-qualification-benchmark-request"[\s\S]*claimRequestApproval/,
  "the HTTP boundary stores owner request authority rather than triggering a render");
assert.doesNotMatch(endpoint, /tasks\.trigger|createRouteQualificationBenchmarkInput|productionRouteQualificationRequirement/,
  "the browser endpoint avoids a provider/task or heavy render-engine path");

console.log("Route qualification benchmark control UI contracts passed");
