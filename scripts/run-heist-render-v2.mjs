// Victor — Great Train Robbery v2: Hailuo 2.3 STANDARD 768p (8 scenes incl. getaway),
// richer motion prompts, per-shot diegetic SFX (MMAudio), CassetteAI music bed,
// Clyde narration timed to shots + best-effort lip-sync on the talking shots (hook+train),
// upscaled 768p→1080p, published to /var/www/html/lustig/.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const FAL_KEY = process.env.FAL_KEY;
const ELEVEN = process.env.ELEVENLABS_API_KEY;
if (!FAL_KEY || !ELEVEN) throw new Error("need FAL_KEY + ELEVENLABS_API_KEY");
const CLYDE = "2EiwWnXFnvU5JabPnv8n";
const OUT = "/var/www/html/lustig";
const TMP = "/tmp/heist2"; fs.mkdirSync(TMP, { recursive: true });
const LOG = (m) => console.log(`[v2] ${new Date().toISOString().slice(11,19)} ${m}`);
const sh = (c, a, t = 900000) => execFileSync(c, a, { timeout: t, stdio: ["ignore","pipe","pipe"] });

const SCENES = [
  { id:"1_hook", img:"hook.png", dur:10, talk:true,
    motion:"Slow dolly-in down the aisle toward Victor seated by the rain-streaked window; he turns to lock eyes with camera and speaks, a sly half-smile forming, lips moving. Behind him masked figures sweep torch beams down the swaying carriage. Train rocks gently, rain glows on the glass, lamplight flickers warm. Handheld micro-shake, shallow depth of field, 35mm grain.",
    sfx:"interior of a moving passenger train at night, steady clatter of wheels on tracks, muffled distant shouts, rain tapping the window",
    vo:"Morning after the greatest heist in British history. A hundred and twenty mailbags of cash, and the police radio already knows our farm. I'm Victor." },
  { id:"2_plan", img:"scene1.png", dur:6, talk:false,
    motion:"Slow push-in over the railway map as Victor's finger traces the red route and taps a junction; he glances up to camera. Flat-capped men lean in, one nods, another exhales smoke. Oil-lamp flame wavers, shadows shift on the stone wall. Warm amber key light, deep shadows, 35mm grain.",
    sfx:"quiet farmhouse room, low murmured male voices, a match striking, faint crackle of an oil lamp",
    vo:"We picked the Glasgow mail train. Fifteen men, one perfect trap." },
  { id:"3_signal", img:"scene2.png", dur:10, talk:false,
    motion:"Low tracking shot gliding along the cold steel rail at night. A gloved hand clamps a black glove over the green signal lamp; a wired battery clicks and a false red light blooms. Victor crouches by the rail, breath fogging, and turns a conspiratorial glance to camera. Torch beams knife through drifting mist, dew glints on the tracks. Cold blue-grey, 35mm grain.",
    sfx:"cold night railway trackside, crickets, low electrical hum, gravel crunching underfoot, a distant train horn",
    vo:"You don't derail a train. You lie to it. A glove on the green light, a battery on a false red. And it stops." },
  { id:"4_storm", img:"scene3.png", dur:10, talk:false,
    motion:"Fast handheld rushing toward the halted diesel locomotive as masked men climb the cab. Victor grips the footplate handrail and swings up, adrenaline sharp on his face, throwing a quick grin back to camera. Steam vents hiss, a lamp swings, boots scramble on metal. Hard directional light, deep contrast, motion blur, 35mm grain.",
    sfx:"diesel locomotive idling and hissing, clanging metal, boots scrambling, urgent hushed shouts",
    vo:"We swarm the engine. The driver fights, and pays for it. We uncouple the coach that holds the money." },
  { id:"5_train", img:"train.png", dur:6, talk:true,
    motion:"Camera tracks with Victor through the narrow mail carriage past toppled sacks; he hoists a bulging mailbag onto his shoulder, turns to camera and speaks, grinning, lips moving as torch beams rake stacked parcels behind him. The carriage sways, dust drifts in the light. Handheld, shallow focus, 35mm grain.",
    sfx:"inside a mail carriage, rustling canvas sacks, footsteps on wooden floor, muffled voices, train rumble",
    vo:"Inside. A hundred and twenty sacks. Every one of them, ours." },
  { id:"6_chain", img:"scene4.png", dur:10, talk:false,
    motion:"Wide tracking shot down the steep embankment following the human chain passing heavy mailbags hand to hand toward a waiting lorry and Land Rover, headlights blazing through pre-dawn fog. Victor swings a heavy sack down the line and laughs toward camera. Silhouettes strain, breath steams, mud slides underfoot. Cold dawn blue with warm headlight pools, 35mm grain.",
    sfx:"outdoor embankment, grunts of effort, heavy sacks thudding, an idling truck engine, wind over a field",
    vo:"Thirty minutes on the clock. A human chain down the bank. Two point six million pounds into a waiting lorry." },
  { id:"7_loot", img:"scene5.png", dur:6, talk:false,
    motion:"Slow push-in over towering stacks of banknotes as Victor fans a thick wad of pound notes toward camera with a triumphant smirk; behind him men count cash and shift a Monopoly board. Warm dawn light through a dusty window, smoke haze. Shallow focus, 35mm grain.",
    sfx:"farmhouse interior, riffling paper banknotes, low male laughter, clink of glasses, a ticking clock",
    vo:"Back at the farm we count it, and play Monopoly with real money." },
  { id:"8_getaway", img:"scene8_getaway.png", dur:10, talk:false,
    motion:"High-speed chase: camera tracks alongside then behind the speeding getaway van as Victor grips the wheel and grins to camera; the gang behind punch the air and hoot; through the rear window a black police car surges close, headlights flaring; the van swerves hard around startled oncoming traffic, tires screeching, dust and motion blur. Fast whip-pans, handheld energy, low golden afternoon light, 35mm grain.",
    sfx:"roaring van engine accelerating, screeching tires, men whooping and cheering, a police siren wailing closer, car horns blaring",
    vo:"And when the law finally comes? You put your foot down, you laugh, and you vanish into the traffic." },
];
const TOTAL = SCENES.reduce((a,s)=>a+s.dur,0);

async function falQueue(model, body, label) {
  const s = await (await fetch(`https://queue.fal.run/${model}`, { method:"POST", headers:{Authorization:`Key ${FAL_KEY}`,"Content-Type":"application/json"}, body:JSON.stringify(body) })).json();
  if (!s.status_url) throw new Error(`${label} submit: ${JSON.stringify(s).slice(0,180)}`);
  const t0 = Date.now();
  while (Date.now()-t0 < 900000) {
    await new Promise(r=>setTimeout(r,6000));
    const st = await (await fetch(s.status_url,{headers:{Authorization:`Key ${FAL_KEY}`}})).json();
    if (st.status==="COMPLETED") break;
    if (st.status==="FAILED"||st.error) throw new Error(`${label} failed: ${JSON.stringify(st).slice(0,180)}`);
  }
  return await (await fetch(s.response_url,{headers:{Authorization:`Key ${FAL_KEY}`}})).json();
}
const dl = async (url, out) => { fs.writeFileSync(out, Buffer.from(await (await fetch(url)).arrayBuffer())); return out; };
const seedCache = {};
function seed(img){ if(seedCache[img])return seedCache[img]; const j=`${TMP}/seed_${img.replace(/\W/g,"_")}.jpg`; sh("ffmpeg",["-y","-loglevel","error","-i",`${OUT}/${img}`,"-vf","scale=1280:-2","-q:v","4",j]); return seedCache[img]=`data:image/jpeg;base64,${fs.readFileSync(j).toString("base64")}`; }
async function falUpload(buf, ct, ext){
  const init = await (await fetch("https://rest.alpha.fal.ai/storage/upload/initiate",{method:"POST",headers:{Authorization:`Key ${FAL_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({content_type:ct,file_name:`a_${Date.now()}_${Math.floor(Math.random()*1e6)}.${ext}`})})).json();
  if(!init.upload_url||!init.file_url) throw new Error("upload initiate "+JSON.stringify(init).slice(0,120));
  const put = await fetch(init.upload_url,{method:"PUT",headers:{"Content-Type":ct},body:buf});
  if(!put.ok) throw new Error("upload put "+put.status);
  return init.file_url;
}
async function pool(items,n,fn){ const out=[];let i=0; await Promise.all(Array.from({length:n},async()=>{ while(i<items.length){const k=i++; try{out[k]=await fn(items[k],k);}catch(e){out[k]={error:String(e)};LOG("ERR "+e);} } })); return out; }

// ---- TTS (Clyde) per scene ----
LOG("TTS Clyde per scene…");
for (const s of SCENES) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${CLYDE}?output_format=mp3_44100_128`,{method:"POST",headers:{"xi-api-key":ELEVEN,"Content-Type":"application/json"},body:JSON.stringify({text:s.vo,model_id:"eleven_multilingual_v2",voice_settings:{stability:0.4,similarity_boost:0.8,style:0.45}})});
  if(!r.ok) throw new Error("TTS "+s.id+" "+r.status+" "+(await r.text()).slice(0,120));
  fs.writeFileSync(`${TMP}/vo_${s.id}.mp3`, Buffer.from(await r.arrayBuffer()));
}

// ---- render 8 Hailuo Standard clips ----
LOG("Hailuo Standard i2v x8…");
const rendered = await pool(SCENES, 4, async (s) => {
  const res = await falQueue("fal-ai/minimax/hailuo-2.3/standard/image-to-video",
    { image_url: seed(s.img), prompt: s.motion, duration: String(s.dur >= 10 ? 10 : 6), prompt_optimizer: true }, `hai_${s.id}`);
  const url = res?.video?.url; if(!url) throw new Error(`hai_${s.id} no url`);
  const local = await dl(url, `${TMP}/hai_${s.id}.mp4`);
  LOG(`clip ${s.id} ok`);
  return { id:s.id, falUrl:url, local };
});
const clip = {}; rendered.forEach((r)=>{ if(r&&r.id) clip[r.id]=r; });

// ---- per-clip SFX via MMAudio (uses fal-hosted clip URL) ----
LOG("MMAudio SFX x8…");
await pool(SCENES, 4, async (s) => {
  const c = clip[s.id]; if(!c) return;
  try {
    const res = await falQueue("fal-ai/mmaudio-v2", { video_url:c.falUrl, prompt:s.sfx, duration:s.dur, num_steps:25 }, `mma_${s.id}`);
    const u = res?.video?.url; if(!u) throw new Error("no mma url");
    const withA = await dl(u, `${TMP}/mma_${s.id}.mp4`);
    sh("ffmpeg",["-y","-loglevel","error","-i",withA,"-vn","-ac","2","-ar","44100",`${TMP}/sfx_${s.id}.wav`]);
    c.sfx = `${TMP}/sfx_${s.id}.wav`;
  } catch(e){ LOG(`MMAudio ${s.id} skip: ${String(e).slice(0,80)}`); }
});

// ---- best-effort lip-sync on talking shots ----
LOG("lip-sync hook+train (best-effort)…");
for (const s of SCENES.filter(x=>x.talk)) {
  const c = clip[s.id]; if(!c) continue;
  try {
    const vo = fs.readFileSync(`${TMP}/vo_${s.id}.mp3`);
    const audioUrl = await falUpload(vo, "audio/mpeg", "mp3");
    const res = await falQueue("fal-ai/sync-lipsync/v2", { model:"lipsync-2", video_url:c.falUrl, audio_url:audioUrl, sync_mode:"remap" }, `lip_${s.id}`);
    const u = res?.video?.url; if(!u) throw new Error("no lip url");
    c.local = await dl(u, `${TMP}/lip_${s.id}.mp4`);
    c.lip = true; LOG(`lip-sync ${s.id} ok`);
  } catch(e){ LOG(`lip-sync ${s.id} skip: ${String(e).slice(0,90)}`); }
}

// ---- music bed ----
LOG("music (CassetteAI)…");
let musicWav = null;
try {
  const res = await falQueue("CassetteAI/music-generator", { prompt:"Tense cinematic heist score, low pulsing strings, ticking clock, taut percussion, rising suspense then a triumphant swaggering brass finish. Key: A minor. Instrumental.", duration:TOTAL }, "music");
  const u = res?.audio_file?.url; if(u){ musicWav = await dl(u, `${TMP}/music.wav`); }
} catch(e){ LOG(`music skip: ${String(e).slice(0,90)}`); }

// ---- build aligned VO + SFX tracks (each segment padded/trimmed to scene dur) ----
const pad = (inPath, dur, outWav) => sh("ffmpeg",["-y","-loglevel","error","-i",inPath,"-af",`aresample=44100,atrim=0:${dur},apad=whole_dur=${dur}`,"-ac","2","-ar","44100",outWav]);
const silent = (dur, outWav) => sh("ffmpeg",["-y","-loglevel","error","-f","lavfi","-t",String(dur),"-i","anullsrc=r=44100:cl=stereo",outWav]);
const voSegs=[], sfxSegs=[], vidSegs=[];
for (const s of SCENES) {
  const c = clip[s.id];
  // VO segment
  const voSeg = `${TMP}/voseg_${s.id}.wav`; pad(`${TMP}/vo_${s.id}.mp3`, s.dur, voSeg); voSegs.push(voSeg);
  // SFX segment (fallback silent)
  const sfxSeg = `${TMP}/sfxseg_${s.id}.wav`;
  if (c && c.sfx) pad(c.sfx, s.dur, sfxSeg); else silent(s.dur, sfxSeg);
  sfxSegs.push(sfxSeg);
  // video segment scaled to 1080p (silent)
  const vseg = `${TMP}/vseg_${s.id}.mp4`;
  sh("ffmpeg",["-y","-loglevel","error","-i",(c&&c.local)|| `${TMP}/hai_${s.id}.mp4`,"-t",String(s.dur),"-vf","scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25","-an","-c:v","libx264","-crf","19","-preset","medium","-pix_fmt","yuv420p",vseg]);
  vidSegs.push(vseg);
}
const concatList = (paths,name)=>{ const f=`${TMP}/${name}.txt`; fs.writeFileSync(f, paths.map(p=>`file '${p}'`).join("\n")); return f; };
sh("ffmpeg",["-y","-loglevel","error","-f","concat","-safe","0","-i",concatList(voSegs,"vo"),"-c:a","pcm_s16le",`${TMP}/voice.wav`]);
sh("ffmpeg",["-y","-loglevel","error","-f","concat","-safe","0","-i",concatList(sfxSegs,"sfx"),"-c:a","pcm_s16le",`${TMP}/sfxtrack.wav`]);
sh("ffmpeg",["-y","-loglevel","error","-f","concat","-safe","0","-i",concatList(vidSegs,"vid"),"-c:v","copy",`${TMP}/video.mp4`]);

// ---- mix: SFX + music(ducked) + voice ----
const mixInputs = ["-i",`${TMP}/sfxtrack.wav`,"-i",`${TMP}/voice.wav`];
let fc = "[0:a]volume=0.75[sfx];[1:a]volume=1.0[vo];";
if (musicWav) { mixInputs.push("-i",musicWav); fc += "[2:a]volume=0.16,aloop=loop=-1:size=2e9[mus];[sfx][vo][mus]amix=inputs=3:duration=first:normalize=0[a]"; }
else { fc += "[sfx][vo]amix=inputs=2:duration=first:normalize=0[a]"; }
sh("ffmpeg",["-y","-loglevel","error",...mixInputs,"-filter_complex",fc,"-map","[a]","-t",String(TOTAL),"-c:a","aac","-b:a","192k",`${TMP}/final_audio.m4a`]);

// ---- mux ----
const final = `${TMP}/heist_hailuoStd_1080.mp4`;
sh("ffmpeg",["-y","-loglevel","error","-i",`${TMP}/video.mp4`,"-i",`${TMP}/final_audio.m4a`,"-map","0:v","-map","1:a","-c:v","copy","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",final]);
fs.copyFileSync(final, `${OUT}/heist_hailuoStd_1080.mp4`);
const okClips = Object.keys(clip).length, lips = Object.values(clip).filter(c=>c.lip).length, sfxc = Object.values(clip).filter(c=>c.sfx).length;
console.log("###DONE###");
console.log(`clips ${okClips}/8  sfx ${sfxc}/8  lipsync ${lips}  music ${musicWav?"yes":"no"}`);
console.log("URL: http://87.106.233.113/lustig/heist_hailuoStd_1080.mp4");
