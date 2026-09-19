import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { documentaryChannelWorld } from "../documentaryCollageShortBlocks";

const root = process.cwd();
const source = readFileSync(join(root, "src/lib/documotion.ts"), "utf8");
const block = readFileSync(join(root, "src/trigger/blocks/documentaryCollageShortBlocks.ts"), "utf8");

const world = documentaryChannelWorld({
  channelName: "Inked Histories",
  styleGrammar: "engraved editorial history, precise ink hatchwork",
  styleDNA: {
    recurringSubject: "an archivist's gloved hand",
    setting: "a candlelit map room",
    composition: "a single artifact on the left with negative space",
    colorGrade: "warm parchment and charcoal",
    palette: ["#E9D6AE", "#24211D"],
    motifs: ["red wax seal", "opened field journal"],
    visualAvoid: ["game UI", "neon fantasy"],
  },
} as never);

assert.match(world ?? "", /Inked Histories/);
assert.match(world ?? "", /archivist's gloved hand/);
assert.match(world ?? "", /candlelit map room/);
assert.match(world ?? "", /avoid: game UI; neon fantasy/);
assert.equal(documentaryChannelWorld({} as never), undefined, "a channel without identity data must preserve the generic documentary contract");
assert.match(block, /const channelWorld = documentaryChannelWorld\(ctx\.store\)/);
assert.match(block, /channelWorld,/);
assert.match(source, /CHANNEL IDENTITY.*generic genre imagery/);
assert.match(source, /CHANNEL IDENTITY — retain these stable visual anchors/);
assert.match(source, /channel identity: \$\{channelWorld\}/);

console.log("Documentary channel-world visual identity wiring passed");
