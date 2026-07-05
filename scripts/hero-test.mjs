import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { renderOpportunity } from "../src/lib/motioncraft.ts";
const log = (m) => console.error(`[hero] ${m}`);
await bootstrapSecrets(log, { required: ["GEMINI_API_KEY"] });
const op = { id: "never-solved", kind: "hero_title", cue: "never fully solved", reason: "dramatic closer",
  spec: { scene: "A lone abandoned underground bank vault, its massive circular steel door hanging open in the dark, one cold shaft of light falling across scattered empty diamond trays and a dropped jeweler's loupe on the concrete floor, moody noir atmosphere, teal shadows and gold highlights, drifting dust and fog, ultra cinematic",
    kicker: "Case Status", lines: ["NEVER FULLY", "SOLVED"], sub: "THE HEIST OF THE CENTURY", accent: "#e8b23a" } };
const clip = await renderOpportunity(op, "/home/ubuntu/mc-hero", log);
console.log(JSON.stringify(clip, null, 2));
