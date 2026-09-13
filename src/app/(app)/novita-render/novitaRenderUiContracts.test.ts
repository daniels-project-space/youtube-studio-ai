import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const here = new URL(".", import.meta.url);
const page = readFileSync(new URL("./page.tsx", here), "utf8");
const consoleSource = readFileSync(new URL("./H3RenderConsole.tsx", here), "utf8");
const styles = readFileSync(new URL("./h3-render-console.module.css", here), "utf8");

assert.match(page, /H3RenderConsole/);
assert.doesNotMatch(page, /LegacyNovita|RenderFleetHero|renderNovita/i);
assert.match(consoleSource, /Weekly batch/);
assert.match(consoleSource, /Salad · 1–60 approved shots/);
assert.match(consoleSource, /On demand/);
assert.match(consoleSource, /Novita · one approved shot/);
assert.match(consoleSource, /window\.confirm\(/);
assert.match(consoleSource, /\/api\/minimax-h3\/\$\{mode\}/);
assert.match(consoleSource, /mode === "weekly" \? "salad" : "novita"/);
assert.match(consoleSource, /\/api\/minimax-h3\/status/);
assert.match(consoleSource, /localStorage/);
assert.match(styles, /prefers-reduced-motion/);

console.log("Novita render UI contracts passed: H3 Salad weekly and Novita on-demand lanes");
