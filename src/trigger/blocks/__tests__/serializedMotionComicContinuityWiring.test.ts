import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src", "trigger", "blocks", "selfContainedStoryBlocks.ts"),
  "utf8",
);

const routeBinding = source.indexOf("assertSerializedProgramEpisodeContextBinding");
const comicPlanner = source.lastIndexOf("planComicWithCritique(ctx, motionComicBrief(ctx))");

assert.ok(routeBinding >= 0, "serialized comic planning must validate the immutable episode context");
assert.ok(comicPlanner > routeBinding, "serialized context binding must be present before the comic planner is invoked");
assert.match(source, /seriesContinuity/, "the validated context must reach the native comic brief");

console.log("SERIALIZED MOTION COMIC CONTINUITY WIRING PASS");
