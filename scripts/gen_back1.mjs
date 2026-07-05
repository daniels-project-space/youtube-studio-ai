import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(()=>{},{required:["GEMINI_API_KEY"]}); const KEY=process.env.GEMINI_API_KEY;
const P="A detailed Game of Thrones Histories-and-Lore PEN-AND-INK ENGRAVING with crosshatching on ivory paper, sepia ink, FILLING the whole frame edge to edge with rich detail (NOT empty, NOT blank). A deep dwarven mithril MINE CAVERN: dark carved rock walls and pillars, a brilliant glowing silver-white mithril vein running through the stone, carved tunnel arches, a descending carved stone staircase, scaffolding, deep cavern shadow. NO miners, NO people, NO figures — only the detailed cavern. 16:9, NO text, NO border.";
const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${KEY}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:P}]}],generationConfig:{responseModalities:["IMAGE"],imageConfig:{aspectRatio:"16:9",imageSize:"2K"}}}),signal:AbortSignal.timeout(180000)});
const j=await res.json(); const p=(j?.candidates?.[0]?.content?.parts??[]).find(x=>x?.inlineData?.data);
if(!p){console.error("NOIMG",JSON.stringify(j?.error||j).slice(0,140));process.exit(1);}
await writeFile(join(process.cwd(),"output","lorecraft","moria2","s1lay","back.png"),Buffer.from(p.inlineData.data,"base64")); console.log("wrote back 1");
