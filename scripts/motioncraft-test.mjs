// MOTIONCRAFT demo — give it a narration; it SEES which moments deserve a motion
// graphic, picks the best tool per beat, and renders each. Visual-only.
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { craftMotionGraphics } from "../src/lib/motioncraft.ts";

const log = (m) => console.error(`[mc] ${m}`);
await bootstrapSecrets(log, { required: ["GEMINI_API_KEY"] });

const narration =
  process.env.MC_NARRATION ||
  "Two floors beneath the streets of Antwerp's diamond district sat the most secure vault in the world. " +
    "The thieves called themselves the School of Turin — five men, one target. They bypassed ten layers of security: " +
    "a hundred-million-combination lock, infrared, a seismic sensor, a magnetic field, Doppler radar. In a single night " +
    "they walked out with over one hundred million dollars in diamonds and gold. Not one alarm was ever triggered. " +
    "To this day, the heist of the century has never been fully solved.";
const RUN = process.env.MC_RUN_DIR || join(process.cwd(), "output", "motioncraft");

const r = await craftMotionGraphics({ narration, topic: "The 2003 Antwerp Diamond Heist", runDir: RUN, max: 5, log });

console.log(
  JSON.stringify(
    {
      opportunities: r.opportunities.map((o) => ({ id: o.id, kind: o.kind, cue: o.cue, reason: o.reason })),
      clips: r.clips.map((c) => ({ id: c.id, kind: c.kind, tool: c.tool, outPath: c.outPath })),
    },
    null,
    2,
  ),
);
