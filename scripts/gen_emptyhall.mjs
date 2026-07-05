import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
const RUN=join(process.cwd(),"output","lorecraft","moria2","s0lay"); const rd=(f)=>join(RUN,f);
await bootstrapSecrets(()=>{},{required:["GEMINI_API_KEY"]}); const KEY=process.env.GEMINI_API_KEY;
const P="A detailed Game of Thrones Histories-and-Lore PEN-AND-INK ENGRAVING with crosshatching on ivory paper, sepia ink. An EMPTY grand dwarven pillared hall of Khazad-dum: rows of massive carved stone columns and arches receding into deep shadow, a wide stone walkway, glowing braziers, NO figures, NO statues, NO people — completely empty architecture, detailed throughout, filling the frame. 16:9, NO text, NO border.";
const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${KEY}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:P}]}],generationConfig:{responseModalities:["IMAGE"],imageConfig:{aspectRatio:"16:9",imageSize:"2K"}}}),signal:AbortSignal.timeout(180000)});
const j=await res.json(); const p=(j?.candidates?.[0]?.content?.parts??[]).find(x=>x?.inlineData?.data);
if(!p){console.error("NOIMG",JSON.stringify(j?.error||j).slice(0,140));process.exit(1);}
await writeFile(rd("back.png"),Buffer.from(p.inlineData.data,"base64")); console.log("wrote fresh back");
