import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, statSync } from "node:fs";
import { renderQuoteOverlay } from "@/lib/remotionRender";
import { concatAudioWithGaps, applyQuoteOverlays, probe } from "@/lib/ffmpeg";

const FF = process.env.FFMPEG_BIN ?? "ffmpeg";
function sh(b: string, a: string[]): Promise<void> { return new Promise((r,j)=>{const c=spawn(b,a,{stdio:["ignore","ignore","pipe"]});let e="";c.stderr.on("data",d=>e+=d);c.on("close",x=>x===0?r():j(new Error(e.slice(-400))));}); }
function assert(c: boolean, m: string){ console.log(`  ${c?"✓":"✗"} ${m}`); if(!c) process.exitCode=1; }

async function main() {
  const dir = mkdtempSync(join(tmpdir(),"ov-"));
  // 1) render the quote overlay (real Remotion, VP8 alpha)
  console.log("rendering QuoteOverlay…");
  const webm = join(dir,"q.webm");
  await renderQuoteOverlay({ quote: "Death is not the opposite of life but a part of it", highlights: ["Death","life"], outPath: webm, durationSec: 4, width: 1920, height: 1080 });
  const pq = await probe(webm);
  console.log("  quote probe:", JSON.stringify({dur:pq.durationSec,w:pq.width,h:pq.height,vcodec:pq.videoCodec}));
  assert(pq.hasVideo && statSync(webm).size>10000, "quote overlay rendered (alpha vp8)");

  // 2) concatAudioWithGaps: 3 sentences + 0.4s pauses
  const s: string[] = [];
  for (let i=0;i<3;i++){ const p=join(dir,`s${i}.mp3`); await sh(FF,["-y","-f","lavfi","-i",`sine=frequency=${200+i*60}:duration=2`,"-c:a","libmp3lame",p]); s.push(p); }
  const narr = join(dir,"narr.mp3");
  await concatAudioWithGaps(s, 0.4, narr);
  const pn = await probe(narr);
  console.log("  narration dur:", pn.durationSec.toFixed(2), "(expect ~6.8 = 3*2 + 2*0.4)");
  assert(Math.abs(pn.durationSec - 6.8) < 0.6, "per-sentence concat with gaps");

  // 3) applyQuoteOverlays onto a synthetic body video
  const body = join(dir,"body.mp4");
  await sh(FF,["-y","-f","lavfi","-i","color=c=darkslategray:s=1920x1080:r=30:d=12","-i",narr,"-shortest","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",body]);
  const final = join(dir,"final.mp4");
  await applyQuoteOverlays(body, [{path:webm,startSec:3,durSec:4}], final, {blurSigma:16});
  const pf = await probe(final);
  console.log("  final probe:", JSON.stringify({dur:pf.durationSec,w:pf.width,h:pf.height,a:pf.hasAudio}));
  assert(pf.hasVideo && pf.hasAudio && pf.width===1920, "overlay composited (blur+card) onto body");

  console.log(process.exitCode?"\nOVERLAY TEST FAILED":"\nOVERLAY TEST PASSED");
}
main().catch(e=>{console.error("FAILED:",e instanceof Error?e.stack:e);process.exit(1);});
