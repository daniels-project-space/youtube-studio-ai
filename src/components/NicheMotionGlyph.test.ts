import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { channelMotionMotifFor } from "@/lib/channelMotion";

const root = process.cwd();
const glyph = readFileSync(join(root, "src/components/NicheMotionGlyph.tsx"), "utf8");
const css = readFileSync(join(root, "src/components/NicheMotionGlyph.module.css"), "utf8");
const channelCreator = readFileSync(join(root, "src/app/(app)/channels/new/page.tsx"), "utf8");

assert.equal(channelMotionMotifFor({ niche: "history" }), "book");
assert.equal(channelMotionMotifFor({ niche: "history", channelName: "The Drawn Past" }), "pen");
assert.equal(channelMotionMotifFor({ niche: "finance" }), "ledger");
assert.equal(channelMotionMotifFor({ channelName: "Gratitude Springs" }), "mind");
assert.equal(channelMotionMotifFor({ channelName: "Neon Rain LoFi" }), "lofi");
assert.match(glyph, /channelMotionMotifFor/);
assert.match(channelCreator, /<NicheMotionGlyph niche=\{n\.key\}/);
assert.doesNotMatch(channelCreator, /function NicheGlyph/);
assert.match(css, /data-motif="book"/);
assert.match(css, /@keyframes bookTurnLeft/);
assert.match(css, /@keyframes penDraw/);
assert.match(css, /prefers-reduced-motion/);

console.log("Channel motion glyph system tests passed");
