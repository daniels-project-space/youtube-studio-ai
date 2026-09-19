/** Real component + native Chromium decoding/range failures. Local retained media only. */
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page, type Route } from "playwright";

const fixture = process.env.PREVIEW_TEST_VIDEO;
assert.ok(fixture,"PREVIEW_TEST_VIDEO must name an existing >=30-second H.264 MP4; no rendering occurs");
const bytes = await readFile(fixture);
const outputDir = await mkdtemp(join(tmpdir(),"ysa-signed-video-proof-"));
const require = createRequire(import.meta.url);
const esbuild = require(require.resolve("esbuild",{paths:[require.resolve("tsx")]})) as {
  build(options:Record<string,unknown>):Promise<{outputFiles:{path:string;contents:Uint8Array}[]}>;
};
const build = await esbuild.build({
  absWorkingDir:process.cwd(),bundle:true,write:false,outfile:"fixture.js",format:"iife",platform:"browser",jsx:"automatic",
  stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {flushSync} from 'react-dom';
    import {SignedVideoPlayer} from './src/components/SignedVideoPlayer';
    window.nativeErrors=[]; window.nativePlays=[]; window.nativePauses=[]; window.signFetches=[];
    const realFetch=window.fetch.bind(window);
    window.fetch=(url,options)=>{window.signFetches.push({url:String(url),cache:options?.cache});return realFetch(url,options)};
    function Fixture(){
      const [players,setPlayers]=useState([]);
      window.mountPlayers=next=>flushSync(()=>setPlayers(next));
      return players.map(p=><section key={p.id} style={{width:'min(640px,100%)',aspectRatio:'16 / 9',marginBottom:16}}>
        <SignedVideoPlayer assetKey={p.key} src={p.src} controls playsInline preload={p.preload??'metadata'}
          muted={p.muted??true} autoPlay={p.autoPlay??false} data-testid={p.id}
          onError={e=>window.nativeErrors.push({id:p.id,code:e.currentTarget.error?.code})}
          onPlay={e=>window.nativePlays.push(e.currentTarget.getAttribute('src'))}
          onPause={e=>window.nativePauses.push(e.currentTarget.getAttribute('src'))}/>
      </section>);
    }
    createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);
  `},
});
const script = build.outputFiles.find(file=>file.path.endsWith(".js"))!.contents;
const css = build.outputFiles.find(file=>file.path.endsWith(".css"))!.contents;
let fixtureNow = Date.now();
const states = new Map<string,{signs:number;failSigning?:boolean;holdSigning?:boolean;rejectAll?:boolean;rejectFresh?:boolean;holdFreshMedia?:boolean;wrongObject?:boolean;sameReceipt?:boolean;held?:ServerResponse}>();
const mediaRequests:{key:string;receipt:string;range:string;status:number}[]=[];
const signRequests:{key:string;cacheControl:string|null;aborted:boolean}[]=[];
const stamp = (time:number) => new Date(time).toISOString().replace(/[-:]|\.\d{3}/g,"");
const mediaUrl = (key:string,receipt="old",issued=fixtureNow) =>
  `/master.mp4?key=${encodeURIComponent(key)}&receipt=${receipt}&X-Amz-Date=${stamp(issued)}&X-Amz-Expires=3600`;
function replySigning(key:string,res:ServerResponse){
  const state=states.get(key)!;
  if(state.failSigning){res.writeHead(403);res.end("denied");return;}
  res.setHeader("Content-Type","application/json");
  res.setHeader("Cache-Control","private, max-age=600");
  const url=mediaUrl(key,state.sameReceipt?"old":`fresh-${state.signs}`);
  res.end(JSON.stringify({url:state.wrongObject?url.replace("/master.mp4","/other.mp4"):url}));
}
const server=createServer((req,res)=>{
  const url=new URL(req.url??"/","http://fixture.invalid");
  if(url.pathname==="/"){
    res.setHeader("Content-Type","text/html");
    res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:16px;background:#0b1019;color:white;font-family:Arial"><h1>Signed video recovery proof</h1><div id="root"></div><script src="/fixture.js"></script></body></html>');return;
  }
  if(url.pathname==="/fixture.js"){res.setHeader("Content-Type","application/javascript");res.end(script);return;}
  if(url.pathname==="/fixture.css"){res.setHeader("Content-Type","text/css");res.end(css);return;}
  if(url.pathname==="/api/asset-url"){
    const key=url.searchParams.get("key")??"",state=states.get(key);
    if(!state){res.writeHead(403);res.end();return;}
    state.signs++;
    const request={key,cacheControl:req.headers["cache-control"]??null,aborted:false};signRequests.push(request);
    res.on("close",()=>{if(!res.writableEnded)request.aborted=true;});
    if(state.holdSigning){state.held=res;return;}
    replySigning(key,res);return;
  }
  if(url.pathname!=="/master.mp4"){res.writeHead(404);res.end();return;}
  const key=url.searchParams.get("key")??"",receipt=url.searchParams.get("receipt")??"",state=states.get(key);
  const date=url.searchParams.get("X-Amz-Date")??"";
  const issued=Date.parse(date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,"$1-$2-$3T$4:$5:$6Z"));
  const status=!state || state.rejectAll || (receipt.startsWith("fresh")&&state.rejectFresh) || fixtureNow>=issued+3_600_000 ? 403 : 206;
  mediaRequests.push({key,receipt,range:req.headers.range??"",status});
  res.setHeader("Cache-Control","no-store");
  if(status===403){res.writeHead(403);res.end("ExpiredRequest");return;}
  if(receipt.startsWith("fresh")&&state?.holdFreshMedia)return;
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??"");
  const start=range?Number(range[1]):0,end=range?.[2]?Math.min(bytes.length-1,Number(range[2])):bytes.length-1;
  if(start>end){res.writeHead(416);res.end();return;}
  res.writeHead(range?206:200,{
    "Content-Type":"video/mp4","Accept-Ranges":"bytes","Content-Length":end-start+1,
    ...(range?{"Content-Range":`bytes ${start}-${end}/${bytes.length}`}:{})
  });
  // Slow old receipts enough to leave seek targets genuinely unbuffered. A
  // request admitted before expiry may continue; a new expired range gets403.
  if(receipt!=="old"){res.end(bytes.subarray(start,end+1));return;}
  let cursor=start,timer:ReturnType<typeof setTimeout>;
  const send=()=>{
    if(res.destroyed)return;
    const next=Math.min(end+1,cursor+65_536);res.write(bytes.subarray(cursor,next));cursor=next;
    if(cursor>end)res.end();else timer=setTimeout(send,20);
  };
  res.on("close",()=>clearTimeout(timer));send();
});
await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
const address=server.address();assert.ok(address&&typeof address!=="string");
const base=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox"]});
const results:unknown[]=[],failures:string[]=[],errors:string[]=[];
type Player = {id:string;key:string;src:string;preload?:string;muted?:boolean;autoPlay?:boolean};
const add=(key:string,extra:Partial<NonNullable<ReturnType<typeof states.get>>>={})=>{states.set(key,{signs:0,...extra});return key;};
async function mount(page:Page,players:Player[]){
  await page.evaluate(players=>(window as unknown as {mountPlayers:(p:Player[])=>void}).mountPlayers(players),players);
}
async function ready(page:Page,id="target",time?:number){
  await page.waitForFunction(({id,time})=>{
    const v=document.querySelector<HTMLVideoElement>(`video[data-testid="${id}"]`);
    return v&&v.readyState>=2&&!v.error&&v.parentElement?.dataset.signedVideoState==="ready"&&
      (time===undefined||Math.abs(v.currentTime-time)<0.25);
  },{id,time},{timeout:20000});
}
async function media(page:Page,id="target"){
  return page.getByTestId(id).evaluate(v=>{
    const video=v as HTMLVideoElement;
    return {time:video.currentTime,duration:video.duration,ready:video.readyState,paused:video.paused,volume:video.volume,
      muted:video.muted,rate:video.playbackRate,error:video.error?.code??null,src:video.getAttribute("src"),
      sameNode:video===(window as unknown as {originalVideo?:HTMLVideoElement}).originalVideo};
  });
}
async function expire(page:Page){fixtureNow+=3_601_000;await page.clock.setFixedTime(new Date(fixtureNow));}
try{
  const page=await browser.newPage({viewport:{width:1000,height:850},reducedMotion:"reduce"});
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/*",route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await page.goto(base);
  await page.waitForFunction(()=>typeof(window as unknown as {mountPlayers?:unknown}).mountPlayers==="function");
  const check=async(name:string,run:()=>Promise<unknown>)=>{
    if(process.env.SIGNED_VIDEO_PROOF_FILTER&&!name.includes(process.env.SIGNED_VIDEO_PROOF_FILTER))return;
    try{const detail=await run();results.push({name,passed:true,detail});console.log(`PASS ${name}`);}
    catch(error){failures.push(`${name}: ${String(error)}`);console.log(`FAIL ${name}: ${String(error)}`);await page.screenshot({path:join(outputDir,`${results.length}-failure.png`)});}
    await mount(page,[]);
  };

  await check("expired native range rejects then decodes renewed same master",async()=>{
    const key=add("initial-expiry");await mount(page,[{id:"target",key,src:mediaUrl(key,"old",fixtureNow-3_601_000)}]);
    await ready(page);const value=await media(page);assert.equal(states.get(key)!.signs,1);assert.equal(value.paused,true);
    assert.ok(mediaRequests.some(r=>r.key===key&&r.status===403&&r.range.startsWith("bytes=")));
    assert.ok(await page.evaluate(()=>(window as unknown as {nativeErrors:unknown[]}).nativeErrors.length>0));return value;
  });
  await check("paused expiry seek preserves node, time, settings and sibling",async()=>{
    const key=add("paused"),sibling=add("sibling");
    await mount(page,[{id:"target",key,src:mediaUrl(key),autoPlay:true},{id:"sibling",key:sibling,src:mediaUrl(sibling)}]);
    await ready(page);await ready(page,"sibling");
    await page.waitForFunction(()=>(window as unknown as {nativePlays:string[]}).nativePlays.some(src=>src.includes("key=paused")&&src.includes("receipt=old")));
    await page.getByTestId("target").evaluate(node=>{const v=node as HTMLVideoElement;v.pause();v.currentTime=8;v.volume=.35;v.muted=false;v.playbackRate=1.5;(window as unknown as {originalVideo:HTMLVideoElement}).originalVideo=v;});
    await ready(page,"target",8);assert.equal((await media(page)).paused,true,"autoplay was intentionally paused before expiry");
    const siblingBefore=await media(page,"sibling");await expire(page);
    await page.getByTestId("target").evaluate(node=>{(node as HTMLVideoElement).currentTime=25;});
    await page.waitForFunction(()=>document.querySelector('video[data-testid="target"]')?.getAttribute("src")?.includes("fresh-"));
    await ready(page,"target",25);const value=await media(page);
    assert.equal(value.sameNode,true);assert.equal(value.paused,true,JSON.stringify(value));assert.equal(value.volume,.35);assert.equal(value.muted,false);assert.equal(value.rate,1.5);
    assert.equal(states.get(key)!.signs,1);assert.equal(states.get(sibling)!.signs,0);
    assert.ok(mediaRequests.some(r=>r.key===key&&r.receipt==="old"&&r.status===403&&r.range.startsWith("bytes=")));
    assert.equal((await media(page,"sibling")).src,siblingBefore.src);
    await page.screenshot({path:join(outputDir,"paused-and-sibling.png")});return value;
  });
  await check("playing expiry seek restores playback and advances",async()=>{
    const key=add("playing");await mount(page,[{id:"target",key,src:mediaUrl(key)}]);await ready(page);
    await page.locator("h1").click();
    await page.getByTestId("target").evaluate(async node=>{const v=node as HTMLVideoElement;v.currentTime=4;v.volume=.22;v.muted=false;v.playbackRate=1.25;await v.play();(window as unknown as {originalVideo:HTMLVideoElement}).originalVideo=v;});
    await expire(page);await page.getByTestId("target").evaluate(node=>{(node as HTMLVideoElement).currentTime=26;});
    await page.waitForFunction(()=>{const v=document.querySelector<HTMLVideoElement>('video[data-testid="target"]');return v&&v.getAttribute("src")?.includes("fresh-")&&v.currentTime>=26&&v.readyState>=2&&!v.paused&&!v.error;});
    const value=await media(page);assert.equal(value.sameNode,true);assert.equal(value.volume,.22);assert.equal(value.muted,false);assert.equal(value.rate,1.25);assert.equal(states.get(key)!.signs,1);
    await page.waitForTimeout(500);assert.ok((await media(page)).time>value.time+.2);return value;
  });
  await check("unexpired native failure is manual-only",async()=>{
    const key=add("unexpired",{rejectAll:true});await mount(page,[{id:"target",key,src:mediaUrl(key)}]);
    await page.getByRole("button",{name:"Retry video"}).waitFor();assert.equal(states.get(key)!.signs,0);
    states.get(key)!.rejectAll=false;await page.getByRole("button",{name:"Retry video"}).click();await ready(page);
    assert.equal(states.get(key)!.signs,1);return await media(page);
  });
  await check("manual retry reloads a byte-identical signed URL",async()=>{
    const key=add("same-receipt",{rejectAll:true,sameReceipt:true}),src=mediaUrl(key);
    await mount(page,[{id:"target",key,src}]);await page.getByRole("button",{name:"Retry video"}).waitFor();
    await page.getByTestId("target").evaluate(node=>{(window as unknown as {originalVideo:HTMLVideoElement}).originalVideo=node as HTMLVideoElement;});
    states.get(key)!.rejectAll=false;await page.getByRole("button",{name:"Retry video"}).click();await ready(page);
    const value=await media(page);assert.equal(value.src,src);assert.equal(value.sameNode,true);assert.equal(states.get(key)!.signs,1);
    assert.ok(mediaRequests.some(r=>r.key===key&&r.receipt==="old"&&r.status===403));
    assert.ok(mediaRequests.some(r=>r.key===key&&r.receipt==="old"&&r.status===206));return value;
  });
  await check("signing failure terminates; manual retry is real",async()=>{
    const key=add("signing-denied",{failSigning:true});await mount(page,[{id:"target",key,src:mediaUrl(key,"old",fixtureNow-3_601_000)}]);
    await page.getByRole("button",{name:"Retry video"}).waitFor();assert.equal(states.get(key)!.signs,1);
    await page.getByTestId("target").evaluate(node=>{for(let i=0;i<5;i++)node.dispatchEvent(new Event("error"));});
    await page.waitForTimeout(200);assert.equal(states.get(key)!.signs,1);
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:join(outputDir,"phone-manual-retry.png")});
    const retryBox=await page.getByRole("button",{name:"Retry video"}).boundingBox();assert.ok(retryBox&&retryBox.height>=44);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.setViewportSize({width:1000,height:850});
    states.get(key)!.failSigning=false;await page.getByRole("button",{name:"Retry video"}).click();await ready(page);
    assert.equal(states.get(key)!.signs,2);return await media(page);
  });
  await check("fresh replacement failure cannot create an automatic retry loop",async()=>{
    const key=add("replacement-denied",{rejectFresh:true});await mount(page,[{id:"target",key,src:mediaUrl(key,"old",fixtureNow-3_601_000)}]);
    await page.getByRole("button",{name:"Retry video"}).waitFor();assert.equal(states.get(key)!.signs,1);
    await page.getByTestId("target").evaluate(node=>{for(let i=0;i<5;i++)node.dispatchEvent(new Event("error"));});
    await page.waitForTimeout(200);assert.equal(states.get(key)!.signs,1);
    states.get(key)!.rejectFresh=false;await page.getByRole("button",{name:"Retry video"}).click();await ready(page);
    assert.equal(states.get(key)!.signs,2);return await media(page);
  });
  await check("simultaneous native events share one recovery",async()=>{
    const key=add("coalesced",{holdSigning:true});await mount(page,[{id:"target",key,src:mediaUrl(key,"old",fixtureNow-3_601_000)}]);
    await page.locator('[data-signed-video-state="recovering"]').waitFor();
    await page.waitForFunction(()=> (window as unknown as {signFetches:{url:string}[]}).signFetches.some(r=>r.url.includes("coalesced")));
    await page.getByTestId("target").evaluate(node=>{for(let i=0;i<8;i++){node.dispatchEvent(new Event("error"));node.dispatchEvent(new Event("waiting"));node.dispatchEvent(new Event("stalled"));}});
    await page.waitForTimeout(100);assert.equal(states.get(key)!.signs,1);replySigning(key,states.get(key)!.held!);await ready(page);return await media(page);
  });
  await check("key change aborts old signing and discards stale response",async()=>{
    const key=add("cancel-old",{holdSigning:true}),next=add("cancel-new");
    await mount(page,[{id:"target",key,src:mediaUrl(key,"old",fixtureNow-3_601_000)}]);
    await page.locator('[data-signed-video-state="recovering"]').waitFor();
    await page.waitForTimeout(100);assert.equal(states.get(key)!.signs,1);
    const nextSrc=mediaUrl(next);await mount(page,[{id:"target",key:next,src:nextSrc}]);await ready(page);
    replySigning(key,states.get(key)!.held!);await page.waitForTimeout(200);
    assert.equal((await media(page)).src,nextSrc);assert.equal(states.get(next)!.signs,0);
    assert.ok(signRequests.some(r=>r.key===key&&r.aborted));
    assert.equal(mediaRequests.filter(r=>r.key===key&&r.receipt.startsWith("fresh")).length,0);return await media(page);
  });
  await check("unmount aborts pending signing",async()=>{
    const key=add("cancel-unmount",{holdSigning:true});await mount(page,[{id:"target",key,src:mediaUrl(key,"old",fixtureNow-3_601_000)}]);
    await page.locator('[data-signed-video-state="recovering"]').waitFor();await page.waitForTimeout(100);
    await mount(page,[]);await page.waitForTimeout(200);assert.ok(signRequests.some(r=>r.key===key&&r.aborted));
    replySigning(key,states.get(key)!.held!);assert.equal(await page.locator("video").count(),0);return {aborted:true};
  });
  await check("replacement cannot switch object",async()=>{
    const key=add("wrong-object",{wrongObject:true});await mount(page,[{id:"target",key,src:mediaUrl(key,"old",fixtureNow-3_601_000)}]);
    await page.getByRole("button",{name:"Retry video"}).waitFor();assert.equal(states.get(key)!.signs,1);
    assert.ok(!(await media(page)).src?.includes("other.mp4"));return {rejected:true};
  });
  await check("expiry alone and buffered playback do not rotate a healthy URL",async()=>{
    const key=add("buffered"),src=mediaUrl(key,"buffered");await mount(page,[{id:"target",key,src,preload:"auto"}]);await ready(page);
    await page.waitForFunction(()=>{const v=document.querySelector<HTMLVideoElement>('video[data-testid="target"]');return v&&v.buffered.length>0&&v.buffered.start(0)===0&&v.buffered.end(0)>3;});
    await expire(page);await page.waitForTimeout(200);assert.equal(states.get(key)!.signs,0);
    await page.getByTestId("target").evaluate(async node=>{const v=node as HTMLVideoElement;v.currentTime=1;await v.play();});
    await page.waitForTimeout(300);await page.getByTestId("target").evaluate(node=>(node as HTMLVideoElement).pause());
    assert.equal(states.get(key)!.signs,0);assert.equal((await media(page)).src,src);return await media(page);
  });
  for(const pauseAgain of [false,true]) await check(`user ${pauseAgain?"play then pause":"play"} during fresh-source loading is preserved`,async()=>{
    const key=add(pauseAgain?"intent-pause":"intent-play");
    let release!:()=>void;
    const gate=new Promise<void>(done=>{release=done;});
    const handler=async(route:Route)=>{
      const url=new URL(route.request().url());
      if(url.searchParams.get("key")===key&&url.searchParams.get("receipt")?.startsWith("fresh")){
        await gate;await route.continue();
      }else await route.fallback();
    };
    await page.route("**/master.mp4?**",handler);
    try{
      await mount(page,[{id:"target",key,src:mediaUrl(key)}]);await ready(page);
      await page.getByTestId("target").evaluate(node=>{const v=node as HTMLVideoElement;v.currentTime=8;(window as unknown as {originalVideo:HTMLVideoElement}).originalVideo=v;});
      await ready(page,"target",8);await expire(page);
      await page.getByTestId("target").evaluate(node=>{(node as HTMLVideoElement).currentTime=25;});
      await page.waitForFunction(()=>document.querySelector('video[data-testid="target"]')?.getAttribute("src")?.includes("fresh-"));
      await page.getByTestId("target").evaluate(node=>{const v=node as HTMLVideoElement;v.volume=.6;v.muted=false;v.playbackRate=1.75;void v.play().catch(()=>{});});
      await page.waitForFunction(key=>(window as unknown as {nativePlays:string[]}).nativePlays.some(src=>src.includes(key)&&src.includes("fresh-")),key);
      if(pauseAgain){
        await page.getByTestId("target").evaluate(node=>(node as HTMLVideoElement).pause());
        await page.waitForFunction(key=>(window as unknown as {nativePauses:string[]}).nativePauses.some(src=>src.includes(key)&&src.includes("fresh-")),key);
      }
      release();await ready(page,"target",25);await page.waitForTimeout(100);
      const value=await media(page);assert.equal(value.paused,pauseAgain);assert.equal(value.sameNode,true);assert.equal(states.get(key)!.signs,1);
      assert.equal(value.volume,.6);assert.equal(value.muted,false);assert.equal(value.rate,1.75);
      return value;
    }finally{release();await page.unroute("**/master.mp4?**",handler);}
  });
  await check("real15-second signing deadline aborts and permits manual retry",async()=>{
    const key=add("signing-timeout",{holdSigning:true}),start=performance.now();
    await mount(page,[{id:"target",key,src:mediaUrl(key,"old",fixtureNow-3_601_000)}]);
    await page.getByRole("button",{name:"Retry video"}).waitFor({timeout:20000});
    const elapsed=performance.now()-start;assert.ok(elapsed>=14000&&elapsed<19500);assert.equal(states.get(key)!.signs,1);
    await page.waitForTimeout(100);assert.ok(signRequests.some(r=>r.key===key&&r.aborted));
    states.get(key)!.holdSigning=false;await page.getByRole("button",{name:"Retry video"}).click();await ready(page);
    assert.equal(states.get(key)!.signs,2);return {elapsed,media:await media(page)};
  });
  await check("real20-second restore deadline terminates stalled replacement",async()=>{
    const key=add("restore-timeout",{holdFreshMedia:true}),start=performance.now();
    await mount(page,[{id:"target",key,src:mediaUrl(key,"old",fixtureNow-3_601_000)}]);
    await page.waitForFunction(()=>document.querySelector('video[data-testid="target"]')?.getAttribute("src")?.includes("fresh-"));
    await page.getByTestId("target").evaluate(node=>{void(node as HTMLVideoElement).play().catch(()=>{});});
    await page.getByRole("button",{name:"Retry video"}).waitFor({timeout:25000});
    const elapsed=performance.now()-start;assert.ok(elapsed>=19000&&elapsed<24500);assert.equal(states.get(key)!.signs,1);
    assert.equal((await media(page)).paused,true,"terminal timeout cancels pending native play");
    states.get(key)!.holdFreshMedia=false;await page.getByRole("button",{name:"Retry video"}).click();await ready(page);
    assert.equal(states.get(key)!.signs,2);assert.equal((await media(page)).paused,false,"manual retry restores the saved play intent");return {elapsed,media:await media(page)};
  });
  assert.ok((await page.evaluate(()=>(window as unknown as {signFetches:{cache:string}[]}).signFetches)).every(r=>r.cache==="no-store"));
  assert.deepEqual(errors,[]);
  await page.unrouteAll({behavior:"ignoreErrors"});
}finally{
  await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));
  const report={outputDir,fixture,results,failures,errors,mediaRequests,signRequests};
  await writeFile(join(outputDir,"results.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({outputDir,results,failures,errors},null,2));
}
assert.deepEqual(failures,[]);
assert.ok(results.length>0,"at least one real native-video scenario must run");
