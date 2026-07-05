// WHITEBOARDCRAFT e2e — history world: a hand-drawn whiteboard explainer clip on
// "The Fall of the Samurai". Visual engine only: plan → pre-spend gate (validate
// + judge) → gated Banana stills → Seedance 1.5 i2v per panel → concat.
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { castWhiteboard } from "../src/lib/whiteboardcraft.ts";

const log = (m) => console.error(`[whiteboard] ${m}`);
await bootstrapSecrets((m) => console.error(`[boot] ${m}`), { required: ["GEMINI_API_KEY"] });

// Seedance render needs an authed higgsfield session on the box.
process.env.HIGGSFIELD_LIVE = process.env.HIGGSFIELD_LIVE ?? "1";

const RUN_DIR = process.env.WB_RUN_DIR || join(process.cwd(), "output", "whiteboard", "samurai");

// A slice of "real narration" — grounds the lettering + number integrity gate.
const narrationExcerpt =
  "For seven centuries the samurai ruled Japan by the sword. But in 1853 American warships forced the country open, " +
  "and the shogun looked powerless. In 1868 the Meiji Restoration handed power back to the Emperor. The new government " +
  "wanted a modern conscript army with rifles, not a warrior caste. In 1876 it banned the wearing of swords and cut the " +
  "samurai's stipends. In 1877 the last samurai rose in the Satsuma Rebellion under Saigo Takamori — and were crushed by " +
  "the Emperor's modern army. The age of the samurai was over.";

const t0 = Date.now();
const result = await castWhiteboard({
  brief: {
    topic: "The fall of the samurai — how Japan's warrior caste lost its power and was abolished in the Meiji era",
    styleId: "history",
    narrationExcerpt,
    targetSec: 24, // 3×8s — Seedance only allows 4/8/12, 24s ≈ the requested 25s
    resolution: process.env.WB_RES || "720p",
    aspectRatio: "16:9",
  },
  runDir: RUN_DIR,
  log,
});

log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min → ${result.outPath}`);
console.log(
  JSON.stringify(
    {
      out: result.outPath,
      stats: result.stats,
      title: result.plan.title,
      panels: result.plan.panels.map(
        (p) => `${p.idx} (${p.durationSec}s): ${p.beat} | letters: ${p.lettering.join(", ")}`,
      ),
      stillVerdicts: result.panels.map((p) => ({ idx: p.idx, ...p.stillVerdict })),
    },
    null,
    2,
  ),
);
