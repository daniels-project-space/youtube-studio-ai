import assert from "node:assert/strict";
import { assertAutomationWeeklyProvider } from "../weeklyNarrationPolicy";

assert.doesNotThrow(() => assertAutomationWeeklyProvider("qwen3"));
for (const provider of ["fish", "elevenlabs", "unknown", ""]) {
  assert.throws(() => assertAutomationWeeklyProvider(provider), /requires Qwen3/);
}
console.log("Weekly Automation narration rejects non-Qwen providers");
