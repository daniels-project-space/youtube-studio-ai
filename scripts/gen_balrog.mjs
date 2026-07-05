import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
const RUN=join(process.cwd(),"output","lorecraft","moria2"); const rd=(f)=>join(RUN,f);
await bootstrapSecrets(()=>{},{required:["GEMINI_API_KEY"]}); const KEY=process.env.GEMINI_API_KEY;
const P="A detailed Game of Thrones Histories-and-Lore PEN-AND-INK ENGRAVING with crosshatching on ivory paper, sepia ink, selective orange fire, FILLING the whole frame edge to edge with rich detail (NOT empty, NOT blank smoke). FOREGROUND lower-left: a shattered carved dwarven pillar and a cracked iron shield. MID-LEFT, small: armoured dwarves recoiling in terror. RIGHT TWO-THIRDS, looming huge and dominating: a COLOSSAL BALROG demon with a snarling horned beast face, great spread bat-wings, a flaming whip and dark sword, a muscular body of black shadow veined with cracked molten orange fire — solid, detailed, menacing, clearly drawn. The Balrog fills the right of the frame. 16:9, NO text, NO border.";
const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${KEY}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:P}]}],generationConfig:{responseModalities:["IMAGE"],imageConfig:{aspectRatio:"16:9",imageSize:"2K"}}}),signal:AbortSignal.timeout(180000)});
const j=await res.json(); const p=(j?.candidates?.[0]?.content?.parts??[]).find(x=>x?.inlineData?.data);
if(!p){console.error("NOIMG",JSON.stringify(j?.error||j).slice(0,160));process.exit(1);}
await writeFile(rd("scene_2.png"),Buffer.from(p.inlineData.data,"base64")); console.log("wrote 2");
