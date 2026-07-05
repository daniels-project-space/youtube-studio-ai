import { readFile, writeFile } from "node:fs/promises";
const path = "/home/ubuntu/youtube-studio-ai/src/engine/golden.ts";
let s = await readFile(path, "utf8");
if (s.includes('key: "loreshort"')) { console.log("already present"); process.exit(0); }
const anchor = "export const GOLDEN_MODULES: GoldenModule[] = [";
if (!s.includes(anchor)) { console.error("anchor not found"); process.exit(1); }
const entry = `
  {
    key: "loreshort",
    stage: "visual",
    title: "Lore Short — Loreshort Engine",
    engine:
      "Loreshort — Gemini first-person lore script + Nano Banana art + ElevenLabs per-line TTS + Replicate LTX-distilled i2v camera moves + Real-ESRGAN 2K upscale",
    how:
      "A single figure narrates history in FIRST PERSON (GoT \\"Histories & Lore\\" style): one Gemini-Pro call writes a paced " +
      "narration arc plus per-beat layered-depth SCENE prompts; Nano Banana paints each beat in three separated depth planes; " +
      "ElevenLabs voices each line separately so every shot is cut to its exact spoken length. Cheap image-to-video " +
      "(LTX-distilled, ~$0.014/clip) generates a GENUINE 3D camera move per still — real perspective and parallax, not a 2D " +
      "pan — optionally upscaled to 2K by Real-ESRGAN, then ffmpeg fits each shot to its beat, dissolves, titles and grades. " +
      "Swappable art sub-styles (cinematic concept-art, watercolour+pencil); every stage caches so it is fully resumable. " +
      "Standalone in src/lib/loreshort.ts.",
    gates: [
      "story arc ≥ N beats or retry",
      "de-branded visuals (content-policy safe)",
      "per-line TTS exact-timing fit",
      "i2v + upscale retry-on-failure",
      "genuine-3D camera move (not a 2D pan)",
    ],
    status: "golden",
  },`;
s = s.replace(anchor, anchor + entry);
await writeFile(path, s);
console.log("inserted loreshort into GOLDEN_MODULES");
