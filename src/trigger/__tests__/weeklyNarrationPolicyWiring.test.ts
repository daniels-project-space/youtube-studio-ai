import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../planWeekPreparedNarration.ts", import.meta.url), "utf8");
const admission = source.indexOf("assertAutomationWeeklyProvider(provider);");
const reuse = source.indexOf("const prior = await readSidecar");
const review = source.indexOf("await prepareWeeklyScriptReview", reuse);
const synthesis = source.indexOf("await synthNarration", reuse);
assert.ok(admission > 0 && admission < reuse && admission < review && admission < synthesis, "provider admission must precede replay and paid work");
assert.match(source, /assertPlanWeekPreparedNarrationBinding\(\{ prepared: decodePreparedMetadata\(bytes\), manifest, requireQwenEvidence: true, expectedQwenVoice \}\)/);
assert.match(source, /assertPlanWeekPreparedNarrationBinding\(\{ prepared, manifest, requireQwenEvidence: true, expectedQwenVoice \}\)/);
console.log("Weekly narration requires Qwen evidence before replay or dispatch");
