import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
const RUN=join(process.cwd(),"output","lorecraft","moria2"); const rd=(f)=>join(RUN,f);
await bootstrapSecrets(()=>{},{required:["GEMINI_API_KEY"]}); const KEY=process.env.GEMINI_API_KEY;
const STYLE="A Game of Thrones Histories-and-Lore style illustration in CRISP PEN-AND-INK ENGRAVING with fine crosshatching and clean ink linework on ivory paper, muted sepia and restrained selective colour. Detailed line-engraving, NOT painterly, NOT a glowing render. Fills the whole frame edge to edge. Clear depth: a close FOREGROUND element, a prominent mid subject, a deep receding background. Low cinematic angle, epic. 16:9. NO text, NO border.";
const S={0:"FOREGROUND, close at the right edge: a towering intricately carved dwarven stone statue holding aloft a crystal lantern, drawn in detailed engraving linework. MID: a carved stone walkway and a regal dwarf lord. DEEP BACKGROUND: the immense pillared underground hall of Khazad-dûm at its height, endless great carved columns receding, fine crosshatched shadow. Restrained gold accents only.",
2:"FOREGROUND, close low-left: a shattered carved dwarven pillar and a cracked iron shield. MID: small armoured dwarves recoiling in terror, detailed. DEEP BACKGROUND, dominating: a COLOSSAL towering Balrog — a great horned demon of shadow and flame, Durins Bane, looming over the tiny dwarves, menacing, detailed engraving with selective orange fire."};
async function gen(i){
  const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${KEY}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:`${STYLE}\nSCENE: ${S[i]}`}]}],generationConfig:{responseModalities:["IMAGE"],imageConfig:{aspectRatio:"16:9",imageSize:"2K"}}}),signal:AbortSignal.timeout(180000)});
  const j=await res.json(); const p=(j?.candidates?.[0]?.content?.parts??[]).find(x=>x?.inlineData?.data);
  if(!p){console.error(i,"NOIMG",JSON.stringify(j?.error||j).slice(0,140));return;}
  await writeFile(rd(`scene_${i}.png`),Buffer.from(p.inlineData.data,"base64")); console.error("wrote",i);
}
await Promise.all([0,2].map(gen)); console.log("DONE eng");
