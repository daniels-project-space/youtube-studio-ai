import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
const RUN=join(process.cwd(),"output","lorecraft","moria2"); const rd=(f)=>join(RUN,f);
await bootstrapSecrets(()=>{},{required:["GEMINI_API_KEY"]}); const KEY=process.env.GEMINI_API_KEY;
const P="This is a detailed pen-and-ink ENGRAVING of a dwarven hall containing a large carved statue with a lantern on the right and a small dwarf standing in the centre. Redraw the SAME image with BOTH figures completely GONE — in the exact spots where they stood, continue drawing the carved stone pillars, the stone walkway and the receding columned hall. KEEP every other part of the engraving — all the architecture, linework, crosshatching, ivory/sepia tones — fully detailed and IDENTICAL. Only the two figures are erased and filled with matching hall. Detailed, NOT blank, NOT hazy. 16:9, no text.";
const img=await readFile(rd("scene_0c.png"));
const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${KEY}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({contents:[{parts:[{inlineData:{mimeType:"image/png",data:img.toString("base64")}},{text:P}]}],generationConfig:{responseModalities:["IMAGE"],imageConfig:{aspectRatio:"16:9",imageSize:"2K"}}}),signal:AbortSignal.timeout(180000)});
const j=await res.json(); const p=(j?.candidates?.[0]?.content?.parts??[]).find(x=>x?.inlineData?.data);
if(!p){console.error("NOIMG",JSON.stringify(j?.error||j).slice(0,160));process.exit(1);}
await writeFile(rd("s0_bg.png"),Buffer.from(p.inlineData.data,"base64")); console.log("wrote s0_bg");
