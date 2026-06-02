import { spawn } from "node:child_process";
import { join } from "node:path"; import { tmpdir } from "node:os"; import { mkdtempSync } from "node:fs";
import { assembleBeatBody, probe } from "@/lib/ffmpeg";
const FF=process.env.FFMPEG_BIN??"ffmpeg";
function sh(b:string,a:string[]):Promise<void>{return new Promise((r,j)=>{const c=spawn(b,a,{stdio:["ignore","ignore","pipe"]});let e="";c.stderr.on("data",d=>e+=d);c.on("close",x=>x===0?r():j(new Error(e.slice(-300))));});}
async function main(){
  const dir=mkdtempSync(join(tmpdir(),"bb-"));
  const clips:string[]=[];
  // 4 clips of different lengths/colors (one short to test loop-fill)
  const specs=[["red",12],["green",3],["blue",20],["orange",8]] as const;
  for(let i=0;i<specs.length;i++){const p=join(dir,`c${i}.mp4`);await sh(FF,["-y","-f","lavfi","-i",`color=c=${specs[i][0]}:s=1280x720:r=30:d=${specs[i][1]}`,"-c:v","libx264","-pix_fmt","yuv420p",p]);clips.push(p);}
  const out=join(dir,"body.mp4");
  await assembleBeatBody({clipPaths:clips,outPath:out,targetSec:40,tmpDir:dir,beats:[8,16,24,32],width:1280,height:720});
  const p=await probe(out);
  console.log("body probe:",JSON.stringify({dur:p.durationSec,w:p.width,h:p.height}));
  const ok=p.hasVideo && Math.abs(p.durationSec-40)<2 && p.width===1280;
  console.log(ok?"BEATBODY TEST PASSED":"BEATBODY TEST FAILED");
  if(!ok)process.exit(1);
}
main().catch(e=>{console.error("FAILED:",e instanceof Error?e.message:e);process.exit(1);});
