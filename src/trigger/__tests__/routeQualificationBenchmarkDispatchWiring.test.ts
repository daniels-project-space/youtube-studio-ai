import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const endpoint = source("src/app/api/route-qualification-benchmarks/route.ts");
const dispatcher = source("src/trigger/routeQualificationBenchmarkDispatcher.ts");
const runner = source("src/trigger/runPipeline.ts");
const runs = source("convex/runs.ts");
const benchmarkRuns = source("convex/routeQualificationBenchmarkRuns.ts");
const schema = source("convex/schema.ts");

assert.match(
  endpoint,
  /requireStudioActor[\s\S]*confirmPrivateBenchmark must be true[\s\S]*createShell[\s\S]*claimRequestApproval/,
  "only an authenticated owner confirmation may create then seal a private benchmark request",
);
assert.doesNotMatch(
  endpoint,
  /tasks\.trigger|pipelineOverride:\s*body|prompt:\s*body/i,
  "the browser cannot provide pipeline/prompt inputs or directly trigger a benchmark",
);
assert.match(
  dispatcher,
  /verifyStudioActionApproval[\s\S]*routePreflightQualificationEvidence[\s\S]*freezeChannelInceptionProbeContext[\s\S]*prepareRouteQualificationBenchmarkDispatchEnvelope/,
  "the dispatcher rechecks signed owner intent, retained preflight proof, and server-loaded channel state before sealing an envelope",
);
assert.match(
  dispatcher,
  /reapExpiredQueued[\s\S]*routeQualificationBenchmarkDispatchSchedule[\s\S]*deliveryAttempt: receipt\.attempt \+ 1/,
  "accepted-but-never-started private benchmarks reissue their immutable payload with a bounded next delivery",
);
assert.match(
  dispatcher,
  /idempotencyKeys\.create\(request\.idempotencySeed,[\s\S]*scope: "global"/,
  "private benchmark dispatch has a global immutable delivery key",
);
assert.doesNotMatch(dispatcher, /bootstrapSecrets|novita|openai|anthropic/i,
  "the dispatcher itself has no provider path");
assert.match(
  benchmarkRuns,
  /status: "awaiting_route_qualification_benchmark_dispatch"[\s\S]*routeQualificationBenchmarkDispatchState: "pending"/,
  "a private benchmark is never introduced as generic queued cadence work",
);
assert.match(
  runs,
  /kind: "route_qualification_benchmark_awaiting"[\s\S]*exact owner-confirmed private dispatch/,
  "generic Trigger work cannot cross a missing benchmark envelope",
);
assert.match(
  runner,
  /durableRouteQualificationBenchmarkEnvelope[\s\S]*route qualification benchmark task payload is not its durable owner-confirmed dispatch envelope[\s\S]*routeQualificationBenchmarkDispatch/,
  "the worker rechecks durable envelope identity before its execution lease",
);
assert.match(
  schema,
  /routeQualificationBenchmarkDispatchState[\s\S]*by_owner_route_qualification_benchmark_dispatch_deadline/,
  "benchmark queue state/deadline are durable and indexed for recovery",
);

console.log("Route qualification benchmark dispatch wiring tests passed");
