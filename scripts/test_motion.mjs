import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });
const { geminiVisionLocal, parseJsonLoose } = await import("../src/lib/gemini.ts");
const sub = process.argv[2] || "watercolor pencil";
const img = process.argv[3] || "output/loreshort/lotr/scene_0.png";
const raw = await geminiVisionLocal({
  imagePaths: [img], json: true, maxTokens: 700, model: "gemini-2.5-flash",
  prompt:
    `You are the SHOT DIRECTOR for an image-to-video clip (~6s). Look CAREFULLY at this ${sub} illustration ` +
    `and decide what should MOVE to bring it alive, grounded ONLY in what is ACTUALLY visible. Name the real things you see. ` +
    `Return STRICT JSON with these keys: ` +
    `"subject_action" = the main figure/subject's SPECIFIC physical motion; if no clear figure, say "none"; ` +
    `"particles" = sparks/embers/fire/smoke/dust/mist/leaves/snow/water/glowing energy that should flicker/fly/drift — only what suits THIS image; ` +
    `"secondary" = smaller motion: cloth, hair, robes, banners, flames, ripples, breathing; ` +
    `"camera" = ONE smooth cinematic camera move that TRAVELS THROUGH THE DEPTH and reveals parallax, naming real foreground/midground/background; ` +
    `"intensity" = "gentle" | "moderate" | "strong". Be concrete and specific to THIS picture. Output ONLY the JSON object.`,
}).catch((e) => "ERR " + e);
console.log("RAW:", String(raw).slice(0, 900));
try { console.log("PARSED:", JSON.stringify(parseJsonLoose(raw), null, 2)); } catch {}
