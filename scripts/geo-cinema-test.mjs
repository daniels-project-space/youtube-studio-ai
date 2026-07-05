// GEO-CINEMA module test — drives the FULL intelligent pipeline via the module
// orchestrator: fetch real OSM 3D scene → LLM art-direction → detail-sufficiency
// GATE (loops to enrich) → compose → HyperFrames render. Visual-only.
//
//   GEO_QUERY / GEO_HERO / GEO_TOPIC override the default Antwerp scene.
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { craftGeoIntro } from "../src/lib/geoCinema.ts";

const log = (m) => console.error(`[geo] ${m}`);
await bootstrapSecrets(log, { required: ["GEMINI_API_KEY"] });

const query = process.env.GEO_QUERY || "Hoveniersstraat, Antwerp, Belgium";
const heroName = process.env.GEO_HERO || "Antwerp Diamond Centre";
const topic =
  process.env.GEO_TOPIC ||
  "The 2003 Antwerp Diamond Heist — Leonardo Notarbartolo and the School of Turin breached a vault two floors " +
    "underground and stole over 100 million dollars in diamonds.";
const narration =
  "Two floors beneath the streets of Antwerp's diamond district sat the most secure vault in the world. " +
  "Ten layers of security. A hundred million combinations. And one night, it was emptied — without a single alarm.";
const RUN = process.env.GEO_RUN_DIR || join(process.cwd(), "output", "geo", "antwerp");

const r = await craftGeoIntro({ query, runDir: RUN, narration, topic, heroName, out: "geo_intro.mp4", maxVerifyRounds: 2, log });

console.log(
  JSON.stringify(
    {
      outPath: r.outPath,
      verifyRounds: r.rounds,
      visionScore: r.verdict.score,
      visionPass: r.verdict.pass,
      visionVerdict: r.verdict.verdict,
      visionIssues: r.verdict.issues,
      preCheck: { score: r.assessment.score, gaps: r.assessment.gaps },
      labels: r.art.labels,
      mood: { bloomThreshold: r.art.bloomThreshold, fogDensity: r.art.fogDensity, windowDensity: r.art.windowDensity, gradeShadow: r.art.gradeShadow, cam: r.art.cam },
    },
    null,
    2,
  ),
);
