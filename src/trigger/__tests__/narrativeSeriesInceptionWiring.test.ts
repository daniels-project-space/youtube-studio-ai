import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../designChannelInception.ts", import.meta.url), "utf8");
const runner = readFileSync(new URL("../runPipeline.ts", import.meta.url), "utf8");

const optimizedTopics = source.indexOf("const optimized = await optimizeTopics({");
const acceptedResearch = source.indexOf("const research = await loadResearchEvidence();", optimizedTopics);
const horizon = source.indexOf("const horizon = createNarrativeSeriesPlanFromInception({", acceptedResearch);
const persist = source.indexOf("await recordNarrativeSeriesPlan({", horizon);
const channelUpdate = source.indexOf("await convex.mutation(api.channels.updateChannel, {", persist);

assert.ok(optimizedTopics >= 0, "serialized horizon must be derived from the existing channel topic bets");
assert.ok(acceptedResearch > optimizedTopics, "horizon planning must reload accepted research after topic optimisation");
assert.ok(horizon > acceptedResearch, "horizon planning must be bound to the accepted research receipt");
assert.ok(persist > horizon, "a horizon must be persisted before it can be advertised on the channel identity");
assert.ok(channelUpdate > persist, "the channel pointer must only be written after immutable horizon persistence");
assert.match(source, /if \(programBrief\.serializedProgram\) \{/);
assert.match(source, /channelProgramRouteRunSeed\(\{ route, programBrief \}\)/);
assert.match(source, /serializedProgramEpisodeIdentity\(routeSeed\)/);
assert.match(runner, /assertNarrativeSeriesNoGenericSchedule/);
assert.match(source, /narrativeSeriesPlan: narrativeSeriesPlan\.fingerprint/);

console.log("NARRATIVE SERIES INCEPTION WIRING PASS");
