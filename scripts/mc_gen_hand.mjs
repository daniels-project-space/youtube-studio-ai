// Generate a hand+FOREARM holding a marker on a green screen (for keying).
import { writeFile } from "node:fs/promises";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });
const key = process.env.GEMINI_API_KEY;
const prompt =
  "A high-resolution studio photograph of a right hand AND a long bare FOREARM holding a slim black felt-tip marker pen, " +
  "poised as if about to draw. Viewed from above at a slight 3/4 angle. The hand grips the pen near the top; the forearm " +
  "is fully visible and extends down to EXIT the bottom-right corner of the frame (as if the arm reaches in from off-screen). " +
  "Background: a SOLID, perfectly uniform bright chroma-key GREEN (#21d521) filling the whole frame, flat even lighting, NO " +
  "shadows on the green. Realistic skin tone and detail. Only the hand, the pen, and the forearm — nothing else.";
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${key}`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "2K" } } }),
  signal: AbortSignal.timeout(180000),
});
const j = await res.json();
const p = (j?.candidates?.[0]?.content?.parts ?? []).find((x) => x?.inlineData?.data);
if (p) { await writeFile(process.argv[2], Buffer.from(p.inlineData.data, "base64")); console.log("OK", process.argv[2]); }
else console.log("FAIL", JSON.stringify(j?.error || j).slice(0, 200));
