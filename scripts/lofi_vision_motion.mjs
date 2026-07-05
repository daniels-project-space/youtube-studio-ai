// Animatable-objects pass: Gemini Vision reads the still and names the subtle looping
// motion (girl's action, cat, waves, boat, petals, clouds, lanterns) for the i2v prompt.
import { readFileSync, writeFileSync } from "node:fs";
const GK = process.env.GEMINI_API_KEY;
if (!GK) { console.error("no GEMINI_API_KEY"); process.exit(1); }
const IMG = process.argv[2] || "/var/www/html/lofi/beachcafe_still.png";
const img = readFileSync(IMG).toString("base64");
const vp =
  "This is a still for a SEAMLESS lofi/ambient LOOP video. Identify EVERY element that should SUBTLY animate to bring it alive. " +
  "BE SPECIFIC about: (1) the GIRL — give her one small, natural, LOOPABLE action grounded in what she's doing (e.g. tilts the watering can and gently pours water on the flowers, then straightens); " +
  "(2) the CUTE CAT — a small looping motion (paws playfully at a drifting petal, tail flicks, ears twitch, looks up); " +
  "(3) ambient: ocean waves lapping the shore, the wooden boat gently bobbing, cherry-blossom petals drifting down, clouds slowly drifting, lanterns swaying, warm light shimmering on the water. " +
  "The CAMERA stays PERFECTLY STATIC (locked tripod). Return STRICT JSON " +
  '{"motion":"one rich descriptive paragraph of ONLY the subtle looping motion of the named elements, camera locked, suitable as an image-to-video prompt"}.';
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GK}`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ contents: [{ parts: [{ text: vp }, { inline_data: { mime_type: "image/png", data: img } }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 500, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } } }),
});
const j = await res.json();
let motion = "";
try { motion = JSON.parse(j.candidates[0].content.parts.map((p) => p.text).join("")).motion; } catch { /* fallback */ }
if (!motion || motion.length < 30) motion = "The girl gently tilts her watering can and pours a thin stream of water over the potted flowers, then slowly straightens; the fluffy cat paws playfully at a drifting cherry petal and flicks its tail; ocean waves lap softly at the shore and sparkle, the wooden boat bobs gently on the swell, pink cherry petals drift slowly down, clouds drift across the sky, the hanging lanterns sway faintly, warm light shimmers on the water.";
// compose with the lofi locked-camera constitution (from src/engine/prompt/constitution.ts)
const CONSTITUTION =
  "static camera, locked-off shot, fixed framing, tripod shot, only the subject and environment animate in place. " +
  "Preserve the hand-painted anime/lofi aesthetic, soft cel shading, warm ambient glow. Animate ONLY the natural elements described; " +
  "do NOT add new elements; keep all structures and the composition perfectly still; slow gentle looping motion, cozy and calm.";
writeFileSync("/tmp/seed_motion.txt", motion);
writeFileSync("/tmp/seed_prompt.txt", `${motion} ${CONSTITUTION}`);
console.log("MOTION:", motion);
