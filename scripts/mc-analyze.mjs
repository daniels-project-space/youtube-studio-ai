import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { analyzeForMotion } from "../src/lib/motioncraft.ts";
const log = (m) => console.error(`[mc] ${m}`);
await bootstrapSecrets(log, { required: ["GEMINI_API_KEY"] });
const narration =
  "Two floors beneath the streets of Antwerp's diamond district sat the most secure vault in the world. " +
  "The thieves called themselves the School of Turin — five men, one target. They bypassed ten layers of security: " +
  "a hundred-million-combination lock, infrared, a seismic sensor, a magnetic field, Doppler radar. In a single night " +
  "they walked out with over one hundred million dollars in diamonds and gold. Not one alarm was ever triggered. " +
  "To this day, the heist of the century has never been fully solved.";
const ops = await analyzeForMotion({ narration, topic: "The 2003 Antwerp Diamond Heist", max: 5, log });
console.log(JSON.stringify(ops.map(o => ({ id: o.id, kind: o.kind, cue: o.cue, tool: o.kind })), null, 2));
