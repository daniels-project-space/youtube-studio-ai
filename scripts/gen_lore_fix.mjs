import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
const RUN = join(process.cwd(),"output","lorecraft","moria2"); const rd=(f)=>join(RUN,f);
await bootstrapSecrets(()=>{},{required:["GEMINI_API_KEY"]}); const KEY=process.env.GEMINI_API_KEY;
const STYLE="A Game of Thrones Histories-and-Lore style illustration, hand-drawn pen-and-ink / engraving look with muted ivory, gold and sepia tones and selective colour. The composition FILLS THE ENTIRE FRAME edge to edge with rich detail — NOT empty, NOT blank haze. Clear depth: a close foreground element, a prominent mid subject, a defined deep background. Low cinematic angle, epic. 16:9. NO text, NO border, NO empty space.";
const S={1:"A bustling underground mithril mine filling the whole frame. FOREGROUND lower-left: a heavy iron pickaxe and jagged rock. MID, prominent and large: grimy armoured dwarven miners striking a BRILLIANT glowing vein of silver mithril in dark stone, bright sparks. BACKGROUND: carved tunnel supports and a deep cavern with descending carved stairs, faint silver glow. Detailed throughout.",
3:"A ruined hall of Moria filling the whole frame. MID, prominent and large, slightly right: a weary proud dwarven king in heavy tarnished plate armour gripping a great warhammer, looking back over his shoulder, cape. FOREGROUND lower-left: broken carved runestones and cold ash. BACKGROUND: fallen columns, the silent ruined gates and stone tombs of Moria, faint embers and mist. Detailed throughout."};
async function gen(i){
  const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${KEY}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:`${STYLE}\nSCENE: ${S[i]}`}]}],generationConfig:{responseModalities:["IMAGE"],imageConfig:{aspectRatio:"16:9",imageSize:"2K"}}}),signal:AbortSignal.timeout(180000)});
  const j=await res.json(); const p=(j?.candidates?.[0]?.content?.parts??[]).find(x=>x?.inlineData?.data);
  if(!p){console.error(i,"NOIMG",JSON.stringify(j?.error||j).slice(0,140));return;}
  await writeFile(rd(`scene_${i}.png`),Buffer.from(p.inlineData.data,"base64")); console.error("wrote",i);
}
await Promise.all([1,3].map(gen)); console.log("DONE fix");
