import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const filename of [
  "minimaxH3WeeklyBatch.ts",
  "minimaxH3WeeklyCapacityRetry.ts",
  "minimaxH3WeeklyNovitaFallback.ts",
  "minimaxH3WeeklyOpenRelayFallback.ts",
]) {
  const source = readFileSync(resolve(process.cwd(), "src/trigger", filename), "utf8");
  const task = source.indexOf("run: async");
  const retirement = source.indexOf("Studio weekly H3 provider route is retired", task);
  const bootstrap = source.indexOf("await bootstrapSecrets", task);
  assert.ok(task >= 0 && retirement > task, `${filename} must retire its stale task handle`);
  assert.ok(bootstrap < 0 || retirement < bootstrap, `${filename} must stop before loading provider credentials`);
}

console.log("Legacy weekly H3 provider tasks retire before credential setup");
