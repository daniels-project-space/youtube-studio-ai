// Victor v3 — HERO pass: Hailuo 2.3 PRO 1080p (native), SIMPLER single-subject shots
// (anti-morph), Clyde VO, lip-sync hook+train, MMAudio SFX (quieter), CassetteAI music
// DUCKED under VO (sidechain) + de-click fades + loudnorm. No upscale (native 1080p).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const FAL_KEY = process.env.FAL_KEY, ELEVEN = process.env.ELEVENLABS_API_KEY;
if (!FAL_KEY || !ELEVEN) throw new Error("need FAL_KEY + ELEVENLABS_API_KEY");
const CLYDE = "2EiwWnXFnvU5JabPnv8n";
const OUT = "/var/www/html/lustig", TMP = "/tmp/heist3"; fs.mkdirSync(TMP, { recursive: true });
const LOG = (m) => console.log(`[v3] ${new Date().toISOString().slice(11,19)} ${m}`);
const sh = (c,a,t=900000)=>execFileSync(c,a,{timeout:t,stdio:["ignore","pipe","pipe"]});
const DUR = 6; // Hailuo Pro is fixed 6s

// SIMPLER prompts: one clear subject (Victor), slow controlled camera, minimal background motion → far less morph.
const SCENES = [
  { id:"1_hook", img:"hook.png", talk:true,
    motion:"Slow steady dolly-in toward Victor seated calmly by the rain-streaked train window; he turns his head and speaks to camera with a sly half-smile. Soft lamplight, gentle rain on the glass, minimal background motion. Locked smooth camera, shallow depth of field, 35mm film, photorealistic.",
    sfx:"quiet interior of a moving train at night, soft steady wheel clatter, faint rain on the window",
    vo:"Morning after the greatest heist in British history. And the police already know our farm. I'm Victor." },
  { id:"2_plan", img:"scene1.png", talk:false,
    motion:"Slow gentle push-in on Victor as he looks up from the railway map and gives a knowing glance to camera, one hand resting on the table. Warm still lamplight, background figures softly out of focus. Smooth minimal camera, 35mm film, photorealistic.",
    sfx:"quiet farmhouse room, low male voices, a crackling oil lamp",
    vo:"We picked the Glasgow mail train. Fifteen men, one perfect trap." },
  { id:"3_signal", img:"scene2.png", talk:false,
    motion:"Near-static low shot by the railway line at night; Victor crouches, turns and looks to camera; a single red signal light glows softly in the mist behind him. Very subtle camera drift, calm and atmospheric. 35mm film, photorealistic.",
    sfx:"cold night trackside, crickets, a soft electrical hum, distant train horn",
    vo:"You don't derail a train. You lie to it. A false red light, and it stops." },
  { id:"4_storm", img:"scene3.png", talk:false,
    motion:"Medium shot, controlled slow push-in: Victor stands beside the halted locomotive with one hand on the rail and turns to camera; steam drifts gently, a lantern glows. Contained motion, no crowd. 35mm film, photorealistic.",
    sfx:"idling diesel locomotive, gentle hiss of steam, low distant voices",
    vo:"We take the engine. We uncouple the one coach that holds the money." },
  { id:"5_train", img:"train.png", talk:true,
    motion:"Victor stands in the mail carriage holding a single mailbag, turns to camera and speaks with a grin; soft torchlight, gentle sway, quiet background. Smooth handheld, shallow focus, 35mm film, photorealistic.",
    sfx:"inside a mail carriage, soft rustle of a canvas sack, gentle train rumble",
    vo:"Inside. A hundred and twenty sacks. Every one of them, ours." },
  { id:"6_chain", img:"scene4.png", talk:false,
    motion:"Medium shot, slow steady camera: Victor hands one heavy mailbag toward a waiting van and glances to camera; a couple of figures behind him, headlights glowing in the fog. Contained action. 35mm film, photorealistic.",
    sfx:"outdoor night, a heavy sack thud, an idling truck engine, soft wind",
    vo:"Two point six million pounds, into a waiting lorry. Thirty minutes flat." },
  { id:"7_loot", img:"scene5.png", talk:false,
    motion:"Slow gentle push-in on Victor fanning a wad of banknotes toward camera with a smirk; neat stacks of cash on the table, warm dawn light, still room. Smooth camera, shallow focus, 35mm film, photorealistic.",
    sfx:"quiet room, riffling paper banknotes, low laughter, a ticking clock",
    vo:"Back at the farm we count it. And play Monopoly, with real money." },
  { id:"8_getaway", img:"scene8_getaway.png", talk:false,
    motion:"Smooth single tracking shot beside the van: Victor drives with both hands on the wheel and a determined grin, glancing to camera; countryside blurs gently past the window, warm afternoon light. One police car distant behind. Steady controlled motion. 35mm film, photorealistic.",
    sfx:"a steady car engine on the open road, a distant police siren, wind",
    vo:"And when the law comes? You put your foot down, and you vanish." },
];
const TOTAL = SCENES.length * DUR;

async function q(model, body, label){
  const s=await(await fetch(`https://queue.fal.run/${model}`,{method:"POST",headers:{Authorization:`Key ${FAL_KEY}`,"Content-Type":"application/json"},body:JSON.stringify(body)})).json();
  if(!s.status_url) throw new Error(`${label} submit ${JSON.stringify(s).slice(0,160)}`);
  const t0=Date.now();
  while(Date.now()-t0<900000){ await new Promise(r=>setTimeout(r,6000));
    const st=await(await fetch(s.status_url,{headers:{Authorization:`Key ${FAL_KEY}`}})).json();
    if(st.status==="COMPLETED")break; if(st.status==="FAILED"||st.error)throw new Error(`${label} failed ${JSON.stringify(st).slice(0,160)}`);}
  return await(await fetch(s.response_url,{headers:{Authorization:`Key ${FAL_KEY}`}})).json();
}
const dl=async(u,o)=>{fs.writeFileSync(o,Buffer.from(await(await fetch(u)).arrayBuffer()));return o;};
const seedCache={};
const seed=(img)=>{if(seedCache[img])return seedCache[img];const j=`${TMP}/seed_${img.replace(/\W/g,"_")}.jpg`;sh("ffmpeg",["-y","-loglevel","error","-i",`${OUT}/${img}`,"-vf","scale=1280:-2","-q:v","4",j]);return seedCache[img]=`data:image/jpeg;base64,${fs.readFileSync(j).toString("base64")}`;};
async function falUpload(buf,ct,ext){
  const init=await(await fetch("https://rest.alpha.fal.ai/storage/upload/initiate",{method:"POST",headers:{Authorization:`Key ${FAL_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({content_type:ct,file_name:`a_${Date.now()}_${Math.floor(Math.random()*1e6)}.${ext}`})})).json();
  if(!init.upload_url||!init.file_url)throw new Error("upload init");
  const p=await fetch(init.upload_url,{method:"PUT",headers:{"Content-Type":ct},body:buf}); if(!p.ok)throw new Error("upload put "+p.status);
  return init.file_url;
}
async function pool(items,n,fn){const out=[];let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const k=i++;try{out[k]=await fn(items[k],k);}catch(e){out[k]={error:String(e)};LOG("ERR "+e);}}}));return out;}

LOG("TTS Clyde…");
for(const s of SCENES){
  const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${CLYDE}?output_format=mp3_44100_128`,{method:"POST",headers:{"xi-api-key":ELEVEN,"Content-Type":"application/json"},body:JSON.stringify({text:s.vo,model_id:"eleven_multilingual_v2",voice_settings:{stability:0.45,similarity_boost:0.8,style:0.4}})});
  if(!r.ok)throw new Error("tts "+s.id+" "+r.status); fs.writeFileSync(`${TMP}/vo_${s.id}.mp3`,Buffer.from(await r.arrayBuffer()));
}
LOG("Hailuo PRO 1080p i2v x8…");
const rendered=await pool(SCENES,4,async(s)=>{
  const res=await q("fal-ai/minimax/hailuo-2.3/pro/image-to-video",{image_url:seed(s.img),prompt:s.motion,prompt_optimizer:true},`pro_${s.id}`);
  const u=res?.video?.url; if(!u)throw new Error(`pro_${s.id} no url`);
  LOG(`clip ${s.id} ok`); return {id:s.id,falUrl:u,local:await dl(u,`${TMP}/pro_${s.id}.mp4`)};
});
const clip={}; rendered.forEach(r=>{if(r&&r.id)clip[r.id]=r;});
LOG("MMAudio SFX x8…");
await pool(SCENES,4,async(s)=>{const c=clip[s.id];if(!c)return;
  try{const res=await q("fal-ai/mmaudio-v2",{video_url:c.falUrl,prompt:s.sfx,duration:DUR,num_steps:25},`mma_${s.id}`);
    const u=res?.video?.url; if(!u)throw new Error("no url"); await dl(u,`${TMP}/mma_${s.id}.mp4`);
    sh("ffmpeg",["-y","-loglevel","error","-i",`${TMP}/mma_${s.id}.mp4`,"-vn","-ac","2","-ar","44100",`${TMP}/sfx_${s.id}.wav`]); c.sfx=`${TMP}/sfx_${s.id}.wav`;
  }catch(e){LOG(`mma ${s.id} skip ${String(e).slice(0,70)}`);}
});
LOG("lip-sync hook+train…");
for(const s of SCENES.filter(x=>x.talk)){const c=clip[s.id];if(!c)continue;
  try{const au=await falUpload(fs.readFileSync(`${TMP}/vo_${s.id}.mp3`),"audio/mpeg","mp3");
    const res=await q("fal-ai/sync-lipsync/v2",{model:"lipsync-2",video_url:c.falUrl,audio_url:au,sync_mode:"remap"},`lip_${s.id}`);
    const u=res?.video?.url; if(!u)throw new Error("no url"); c.local=await dl(u,`${TMP}/lip_${s.id}.mp4`); c.lip=true; LOG(`lip ${s.id} ok`);
  }catch(e){LOG(`lip ${s.id} skip ${String(e).slice(0,80)}`);}
}
LOG("music…");
let music=null;
try{const res=await q("CassetteAI/music-generator",{prompt:"Tense cinematic heist underscore, low pulsing strings, ticking clock, taut percussion, a restrained rising suspense with a sly swaggering finish. Instrumental, key A minor, moderate.",duration:TOTAL},"music");
  const u=res?.audio_file?.url; if(u)music=await dl(u,`${TMP}/music.wav`);}catch(e){LOG("music skip "+String(e).slice(0,70));}

// aligned tracks with de-click fades
const pad=(inp,out)=>sh("ffmpeg",["-y","-loglevel","error","-i",inp,"-af",`aresample=44100,atrim=0:${DUR},apad=whole_dur=${DUR},afade=t=in:st=0:d=0.03,afade=t=out:st=${DUR-0.05}:d=0.05`,"-ac","2","-ar","44100",out]);
const sil=(out)=>sh("ffmpeg",["-y","-loglevel","error","-f","lavfi","-t",String(DUR),"-i","anullsrc=r=44100:cl=stereo",out]);
const vo=[],sfx=[],vid=[];
for(const s of SCENES){const c=clip[s.id];
  const v=`${TMP}/voseg_${s.id}.wav`; pad(`${TMP}/vo_${s.id}.mp3`,v); vo.push(v);
  const x=`${TMP}/sfxseg_${s.id}.wav`; if(c&&c.sfx)pad(c.sfx,x);else sil(x); sfx.push(x);
  const g=`${TMP}/vseg_${s.id}.mp4`;
  sh("ffmpeg",["-y","-loglevel","error","-i",(c&&c.local)||`${TMP}/pro_${s.id}.mp4`,"-t",String(DUR),"-vf","scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25","-an","-c:v","libx264","-crf","18","-preset","medium","-pix_fmt","yuv420p",g]); vid.push(g);
}
const L=(p,n)=>{const f=`${TMP}/${n}.txt`;fs.writeFileSync(f,p.map(x=>`file '${x}'`).join("\n"));return f;};
sh("ffmpeg",["-y","-loglevel","error","-f","concat","-safe","0","-i",L(vo,"vo"),"-c:a","pcm_s16le",`${TMP}/voice.wav`]);
sh("ffmpeg",["-y","-loglevel","error","-f","concat","-safe","0","-i",L(sfx,"sfx"),"-c:a","pcm_s16le",`${TMP}/sfxtrack.wav`]);
sh("ffmpeg",["-y","-loglevel","error","-f","concat","-safe","0","-i",L(vid,"vid"),"-c:v","copy",`${TMP}/video.mp4`]);

// MIX: music DUCKED under voice (sidechain), sfx quiet, voice full, then loudnorm
LOG("mixing (ducked)…");
const ins=["-i",`${TMP}/sfxtrack.wav`,"-i",`${TMP}/voice.wav`];
let fc;
if(music){ ins.push("-i",music);
  fc="[2:a]volume=0.5,aloop=loop=-1:size=2e9,atrim=0:"+TOTAL+"[mus];"+
     "[mus][1:a]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350[mduck];"+
     "[0:a]volume=0.4[sfxq];"+
     "[1:a]volume=1.0[v/];"+
     "[mduck][sfxq][v/]amix=inputs=3:duration=first:normalize=0[mx];"+
     "[mx]loudnorm=I=-15:TP=-1.5:LRA=11[a]";
} else {
  fc="[0:a]volume=0.4[sfxq];[1:a]volume=1.0[v/];[sfxq][v/]amix=inputs=2:duration=first:normalize=0[mx];[mx]loudnorm=I=-15:TP=-1.5:LRA=11[a]";
}
sh("ffmpeg",["-y","-loglevel","error",...ins,"-filter_complex",fc,"-map","[a]","-t",String(TOTAL),"-c:a","aac","-b:a","192k",`${TMP}/audio.m4a`]);
const final=`${TMP}/heist_pro1080.mp4`;
sh("ffmpeg",["-y","-loglevel","error","-i",`${TMP}/video.mp4`,"-i",`${TMP}/audio.m4a`,"-map","0:v","-map","1:a","-c:v","copy","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",final]);
fs.copyFileSync(final,`${OUT}/heist_pro1080.mp4`);
// montage of one frame per scene for morph review
const frames=[];
for(const s of SCENES){const f=`${TMP}/thumb_${s.id}.jpg`;try{sh("ffmpeg",["-y","-loglevel","error","-ss","3","-i",`${TMP}/vseg_${s.id}.mp4`,"-frames:v","1","-vf","scale=640:-1",f]);frames.push(f);}catch{}}
try{sh("ffmpeg",["-y","-loglevel","error","-i",frames[0],"-i",frames[1],"-i",frames[2],"-i",frames[3],"-i",frames[4],"-i",frames[5],"-i",frames[6],"-i",frames[7],"-filter_complex","[0][1][2][3]hstack=4[t];[4][5][6][7]hstack=4[b];[t][b]vstack[o]","-map","[o]",`${OUT}/heist_pro1080_contact.jpg`]);}catch(e){LOG("montage skip "+String(e).slice(0,60));}
console.log("###DONE###");
console.log(`clips ${Object.keys(clip).length}/8 sfx ${Object.values(clip).filter(c=>c.sfx).length}/8 lip ${Object.values(clip).filter(c=>c.lip).length} music ${music?"yes":"no"}`);
console.log("VIDEO: http://87.106.233.113/lustig/heist_pro1080.mp4");
console.log("CONTACT: http://87.106.233.113/lustig/heist_pro1080_contact.jpg");
