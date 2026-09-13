import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const consoleSource = readFileSync(new URL("./H3RenderConsole.tsx", import.meta.url), "utf8");

assert.match(page, /H3RenderConsole/);
assert.doesNotMatch(page, /LegacyNovita|renderNovita/i);
assert.match(consoleSource, /weekly Salad batch/);
assert.match(consoleSource, /Novita on-demand render/);
assert.match(consoleSource, /\/api\/minimax-h3\/\$\{mode\}/);
assert.match(consoleSource, /H3_TRACKING_STORAGE_KEY/);

console.log("Novita render page is wired exclusively to the H3 control plane");
