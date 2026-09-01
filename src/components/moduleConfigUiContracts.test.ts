import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const section = readFileSync(join(root, "src/components/ModuleConfigSection.tsx"), "utf8");
const panel = readFileSync(join(root, "src/components/ModuleConfigPanel.tsx"), "utf8");
const css = readFileSync(join(root, "src/components/ModuleConfigSection.module.css"), "utf8");

assert.match(section, /open=\{open\}/u);
assert.match(section, /openBlockId[\s\S]*setOpenBlockId/u, "the rack must coordinate one open stage instead of stacking panels");
assert.match(section, /styles\.capabilities/u, "each stage must explain its useful capabilities");
assert.match(section, /role="alert"/u, "save errors remain assistive-technology visible");
assert.match(panel, /function humanLabel/u, "internal camel/snake case must not leak into operator labels");
assert.match(panel, /knob\.type === "text"[\s\S]*<textarea/u, "text directions must render as text instead of a numeric slider");
assert.match(panel, /minHeight: 44/u, "form controls must keep the mobile touch floor");
assert.match(panel, /MiniMax-Music3 attribution and generation disclosure/u);
assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.body\s*\{[\s\S]*grid-template-columns: 1fr/u);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);

console.log("MODULE CONFIG UI PASS: progressive stage rack, human labels, disclosure, touch floor, and reduced motion");
