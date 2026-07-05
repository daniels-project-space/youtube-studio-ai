import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
const RUN = join(process.cwd(), "output", "lorecraft", "castle"); const rd = (f) => join(RUN, f);
await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });
const KEY = process.env.GEMINI_API_KEY;
const P = "Edit this pen-and-ink engraving: REMOVE ONLY the tall foreground grass and wheat blades. KEEP the armoured warrior leaning on his greatsword and the castle exactly as they are. Show the warrior standing on open low ground with the castle and sky behind, no tall grass in front of him. Same engraving linework, ivory/sepia palette, haze, perspective. 16:9, NO text.";
if (!existsSync(rd("bg2.png"))) {
  const img = await readFile(rd("scene_c.png"));
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${KEY}`, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ contents:[{parts:[{inlineData:{mimeType:"image/png",data:img.toString("base64")}},{text:P}]}], generationConfig:{responseModalities:["IMAGE"],imageConfig:{aspectRatio:"16:9",imageSize:"2K"}} }), signal: AbortSignal.timeout(180000) });
  const j = await res.json(); const p=(j?.candidates?.[0]?.content?.parts??[]).find(x=>x?.inlineData?.data);
  if(!p) throw new Error("no image "+JSON.stringify(j?.error||j).slice(0,200));
  await writeFile(rd("bg2.png"), Buffer.from(p.inlineData.data,"base64"));
}
console.log("DONE bg2");
