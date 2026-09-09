/** Actual RecentVideos -> dialog -> URL hook -> SignedVideoPlayer integration.
 * Only Convex's data transport and local HTTP media/signing endpoints are fixtures.
 * Uses retained media, bundled production CSS and native Chromium range decoding.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";

const fixture=process.env.PREVIEW_TEST_VIDEO;
assert.ok(fixture,"PREVIEW_TEST_VIDEO must name an existing >=30-second H.264 MP4");
const bytes=await readFile(fixture),outputDir=await mkdtemp(join(tmpdir(),"ysa-recent-video-recovery-"));
const require=createRequire(import.meta.url);
type FixtureBuild={
  onResolve(options:{filter:RegExp},callback:(args:{path:string})=>{path:string;namespace?:string}):void;
  onLoad(options:{filter:RegExp;namespace:string},callback:()=>{contents:string;loader:string;resolveDir:string}):void;
};
const esbuild=require(require.resolve("esbuild",{paths:[require.resolve("tsx")]})) as {
  build(options:Record<string,unknown>):Promise<{outputFiles:{path:string;contents:Uint8Array}[]}>;
};
const build=await esbuild.build({absWorkingDir:process.cwd(),bundle:true,write:false,outfile:"fixture.js",format:"iife",platform:"browser",jsx:"automatic",
  stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {RecentVideos} from './src/components/RecentVideos';
    window.signFetches=[];
    const nativeFetch=window.fetch.bind(window);
    window.fetch=(url,options)=>{if(String(url).startsWith('/api/asset-url'))window.signFetches.push({url:String(url),cache:options?.cache??null});return nativeFetch(url,options)};
    createRoot(document.getElementById('root')).render(<React.StrictMode><RecentVideos ownerId="owner_proof"/></React.StrictMode>);
  `},plugins:[{name:"fixture-data-transport",setup(build:FixtureBuild){
    build.onResolve({filter:/^convex\/react$/},()=>({path:"convex-data-fixture",namespace:"fixture"}));
    build.onLoad({filter:/.*/,namespace:"fixture"},()=>({loader:"js",resolveDir:process.cwd(),contents:`
      import {useEffect,useState} from 'react';
      export function useQuery(_reference,args){
        const [rows,setRows]=useState();
        useEffect(()=>{let cancelled=false;
          fetch('/fixture/videos'+location.search).then(response=>response.json()).then(data=>{if(!cancelled)setRows(data)});
          return()=>{cancelled=true};
        },[args.ownerId,args.channelId,args.limit]);
        return rows;
      }
    `}));
    build.onResolve({filter:/^@\//},args=>({path:resolve("src",args.path.slice(2)+".ts")}));
  }}],
});
const script=build.outputFiles.find(file=>file.path.endsWith(".js"))!.contents;
const css=build.outputFiles.find(file=>file.path.endsWith(".css"))!.contents;
let now=Date.now();
type Scenario={initialSigningFailure:boolean;mediaFailure:boolean;sharedPreview:boolean};
const scenarios=new Map<string,Scenario>(),signs=new Map<string,number>();
const requests:{key:string;kind:"sign"|"media";status:number;range?:string;generation?:number}[]=[];
const keyFor=(scenario:string,name:string)=>`owner/owner_proof/${scenario}/${name}`;
const stamp=(time:number)=>new Date(time).toISOString().replace(/[-:]|\.\d{3}/g,"");
const signedUrl=(key:string,generation:number)=>`/media/${encodeURIComponent(key)}?generation=${generation}&X-Amz-Date=${stamp(now)}&X-Amz-Expires=3600`;
const server=createServer((req,res)=>{
  const url=new URL(req.url??"/","http://fixture.invalid");
  if(req.method!=="GET"){res.writeHead(405);res.end();return;}
  if(url.pathname==="/"){
    res.setHeader("Content-Type","text/html");
    res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>:root{--color-bg:#0b1019;--color-fg:#f7f9fc;--color-muted:#c0c9d7;--color-faint:#8191a8;--color-border:#334155;--color-border-strong:#627591;--color-surface:#162033;--color-accent:#72dfff}*{box-sizing:border-box}body{margin:0;padding:20px;background:#0b1019;color:#f7f9fc;font:16px Arial}main{max-width:1100px;margin:auto}#before,#after{min-height:44px;margin:12px 0}</style></head><body><main><button id="before">Outside before</button><div id="root"></div><button id="after">Outside after</button></main><script src="/fixture.js"></script></body></html>');return;
  }
  if(url.pathname==="/fixture.js"){res.setHeader("Content-Type","application/javascript");res.end(script);return;}
  if(url.pathname==="/fixture.css"){res.setHeader("Content-Type","text/css");res.end(css);return;}
  if(url.pathname==="/fixture/videos"){
    const scenario=url.searchParams.get("scenario")??"",config=scenarios.get(scenario);assert.ok(config);
    const main={_id:"main",title:"Retained proof master",channelName:"Proof channel",thumbnailKey:keyFor(scenario,"thumbnail.svg"),videoKey:keyFor(scenario,"main.mp4"),durationSec:31.022,createdAt:1_788_800_000_000};
    const sibling={...main,_id:"sibling",title:"Independent retained preview",thumbnailKey:null,videoKey:keyFor(scenario,"sibling.mp4")};
    const shared={...main,_id:"shared",title:"Same master, independent preview",thumbnailKey:null};
    res.setHeader("Content-Type","application/json");res.end(JSON.stringify(config.sharedPreview?[main,sibling,shared]:[main,sibling]));return;
  }
  if(url.pathname==="/api/asset-url"){
    const key=url.searchParams.get("key")??"",scenario=key.split("/")[2],config=scenarios.get(scenario);
    if(!config){res.writeHead(403);res.end();return;}
    const count=(signs.get(key)??0)+1;signs.set(key,count);
    const failure=key.endsWith("/main.mp4")&&config.initialSigningFailure&&count===1;
    requests.push({key,kind:"sign",status:failure?503:200});
    if(failure){res.writeHead(503);res.end("Signing unavailable");return;}
    res.setHeader("Content-Type","application/json");res.setHeader("Cache-Control","private, max-age=600");
    res.end(JSON.stringify({url:signedUrl(key,count)}));return;
  }
  if(!url.pathname.startsWith("/media/")){res.writeHead(404);res.end();return;}
  const key=decodeURIComponent(url.pathname.slice(7)),scenario=key.split("/")[2],config=scenarios.get(scenario);
  if(key.endsWith(".svg")){
    res.setHeader("Content-Type","image/svg+xml");res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#17344a"/><text x="40" y="195" fill="#d5efff" font-family="Arial" font-size="32">Retained fixture artwork</text></svg>');return;
  }
  const date=url.searchParams.get("X-Amz-Date")??"";
  const issued=Date.parse(date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,"$1-$2-$3T$4:$5:$6Z"));
  const generation=Number(url.searchParams.get("generation"));
  const status=!config||now>=issued+3_600_000||(key.endsWith("/main.mp4")&&config.mediaFailure)?403:206;
  requests.push({key,kind:"media",status,range:req.headers.range??"",generation});
  res.setHeader("Cache-Control","no-store");
  if(status===403){res.writeHead(403);res.end("ExpiredRequest");return;}
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??"");
  const start=range?Number(range[1]):0,end=range?.[2]?Math.min(bytes.length-1,Number(range[2])):bytes.length-1;
  if(start>end){res.writeHead(416);res.end();return;}
  res.writeHead(range?206:200,{"Content-Type":"video/mp4","Accept-Ranges":"bytes","Content-Length":end-start+1,
    ...(range?{"Content-Range":`bytes ${start}-${end}/${bytes.length}`}:{})});
  if(generation>1){res.end(bytes.subarray(start,end+1));return;}
  let cursor=start,timer:ReturnType<typeof setTimeout>;
  const send=()=>{if(res.destroyed)return;const next=Math.min(end+1,cursor+65_536);res.write(bytes.subarray(cursor,next));cursor=next;if(cursor>end)res.end();else timer=setTimeout(send,20);};
  res.on("close",()=>clearTimeout(timer));send();
});
await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
const address=server.address();assert.ok(address&&typeof address!=="string");const base=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox"]});
const results:unknown[]=[],failures:string[]=[],errors:string[]=[];
async function focusState(page:Page){return page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id,text:document.activeElement?.textContent?.trim().slice(0,80),inside:!!document.querySelector('[role="dialog"]')?.contains(document.activeElement),bodyOverflow:document.body.style.overflow}));}
async function ready(page:Page,time?:number){await page.waitForFunction(time=>{
  const v=document.querySelector<HTMLVideoElement>('[role="dialog"] video');
  return v&&v.readyState>=2&&!v.error&&v.parentElement?.dataset.signedVideoState==="ready"&&(time===undefined||Math.abs(v.currentTime-time)<.25);
},time,{timeout:25000});}
async function closeAndCheck(page:Page){
  await page.keyboard.press("Escape");await page.getByRole("dialog").waitFor({state:"detached"});
  await page.waitForFunction(()=>document.activeElement?.getAttribute("data-render-id")==="main");
  assert.equal(await page.evaluate(()=>document.body.style.overflow),"");
}
async function keyboardLoop(page:Page){
  const close=page.getByRole("button",{name:"Close video"});await close.focus();
  await page.keyboard.press("Shift+Tab");assert.equal((await focusState(page)).inside,true);
  await page.keyboard.press("Tab");assert.equal(await close.evaluate(node=>node===document.activeElement),true);
}
try{
  for(const [name,config] of [
    ["initial-signing-retry",{initialSigningFailure:true,mediaFailure:false,sharedPreview:false}],
    ["native-media-retry",{initialSigningFailure:false,mediaFailure:true,sharedPreview:false}],
    ["expired-dialog-seek",{initialSigningFailure:false,mediaFailure:false,sharedPreview:true}],
  ] as const){
    scenarios.set(name,{...config});
    const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:"reduce"});
    const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
    try{
      await page.route("**/*",route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
      await page.goto(base+"?scenario="+name);
      await page.locator('[data-render-id="main"]').waitFor();
      await page.waitForFunction(()=>{const v=document.querySelector<HTMLVideoElement>('[data-render-id="sibling"] video');return v&&v.readyState>=2&&v.currentTime===15&&v.paused;});
      if(config.sharedPreview)await page.waitForFunction(()=>{const v=document.querySelector<HTMLVideoElement>('[data-render-id="shared"] video');return v&&v.readyState>=2&&v.currentTime===15&&v.paused;});
      const mainKey=keyFor(name,"main.mp4"),siblingKey=keyFor(name,"sibling.mp4");
      const previewBefore=await page.locator('[data-render-id="sibling"] video').evaluate(v=>({src:(v as HTMLVideoElement).currentSrc,time:(v as HTMLVideoElement).currentTime}));
      await page.locator('[data-render-id="main"]').click();await page.getByRole("dialog").waitFor();
      await page.waitForFunction(()=>document.activeElement?.getAttribute("aria-label")==="Close video");
      await page.evaluate(()=>(window as unknown as {originalDialog:Element|null}).originalDialog=document.querySelector('[role="dialog"]'));
      const result:Record<string,unknown>={name};
      if(config.initialSigningFailure||config.mediaFailure){
        const retry=page.getByRole("button",{name:"Retry video"});await retry.waitFor();
        assert.equal(signs.get(mainKey),1,"one failed initial operation, not an automatic retry loop");
        await keyboardLoop(page);
        scenarios.get(name)!.mediaFailure=false;
        await retry.focus();await page.keyboard.press("Enter");await ready(page);
        assert.equal(signs.get(mainKey),2,"manual retry performs one real signing request");
        result.focusAfterRetry=await focusState(page);
        result.dialogStayedMounted=await page.evaluate(()=>document.querySelector('[role="dialog"]')===(window as unknown as {originalDialog:Element|null}).originalDialog);
        assert.equal(result.dialogStayedMounted,true);
        if(!(result.focusAfterRetry as {inside:boolean}).inside)failures.push(`${name}: focused Retry button is removed and focus leaves the dialog`);
        await page.keyboard.press("Tab");result.focusAfterTab=await focusState(page);
        if(!(result.focusAfterTab as {inside:boolean}).inside)failures.push(`${name}: Tab escapes dialog after retry`);
        await page.screenshot({path:join(outputDir,name+".png")});
      }else{
        await ready(page);assert.equal(signs.get(mainKey),1,"dialog shares card's existing signing receipt");
        await page.locator('[role="dialog"] video').evaluate(node=>{const v=node as HTMLVideoElement;v.pause();v.currentTime=8;v.volume=.4;v.muted=false;v.playbackRate=1.25;(window as unknown as {originalVideo:HTMLVideoElement}).originalVideo=v;});
        await ready(page,8);
        const sharedBefore=await page.locator('[data-render-id="shared"] video').evaluate(v=>(v as HTMLVideoElement).currentSrc);
        now+=3_601_000;await page.clock.setFixedTime(new Date(now));
        await page.locator('[role="dialog"] video').evaluate(node=>(node as HTMLVideoElement).currentTime=25);
        await page.waitForFunction(()=>document.querySelector<HTMLVideoElement>('[role="dialog"] video')?.currentSrc.includes("generation=2"));
        await ready(page,25);
        result.media=await page.locator('[role="dialog"] video').evaluate(node=>{const v=node as HTMLVideoElement;return {time:v.currentTime,ready:v.readyState,paused:v.paused,volume:v.volume,muted:v.muted,rate:v.playbackRate,error:v.error?.code??null,sameNode:v===(window as unknown as {originalVideo:HTMLVideoElement}).originalVideo};});
        const media=result.media as {paused:boolean;sameNode:boolean;volume:number;muted:boolean;rate:number};
        assert.equal(media.paused,true);assert.equal(media.sameNode,true);assert.equal(media.volume,.4);assert.equal(media.muted,false);assert.equal(media.rate,1.25);
        assert.equal(signs.get(mainKey),2);assert.ok(requests.some(r=>r.key===mainKey&&r.kind==="media"&&r.status===403&&r.range?.startsWith("bytes=")));
        assert.equal(await page.locator('[data-render-id="shared"] video').evaluate(v=>(v as HTMLVideoElement).currentSrc),sharedBefore);
        await keyboardLoop(page);await page.screenshot({path:join(outputDir,name+".png")});
        await closeAndCheck(page);await page.locator('[data-render-id="main"]').click();await ready(page);
        assert.equal(signs.get(mainKey),3,"reopening refreshes expired shared cache; player recovery did not mutate it");
      }
      await keyboardLoop(page);await closeAndCheck(page);
      const beforeRepeat=signs.get(mainKey);
      for(let i=0;i<5;i++){
        await page.locator('[data-render-id="main"]').click();await ready(page);await keyboardLoop(page);await closeAndCheck(page);
      }
      assert.equal(signs.get(mainKey),beforeRepeat,"five repeated open/close cycles reuse the valid cached receipt");
      assert.equal(signs.get(siblingKey),1,"sibling URL signing is not repeated");
      assert.deepEqual(await page.locator('[data-render-id="sibling"] video').evaluate(v=>({src:(v as HTMLVideoElement).currentSrc,time:(v as HTMLVideoElement).currentTime})),previewBefore);
      result.signRequests=signs.get(mainKey);result.siblingSignRequests=signs.get(siblingKey);result.repeatedCycles=5;
      results.push(result);console.log(JSON.stringify(result));
    }catch(error){failures.push(`${name}: ${String(error)}`);console.log(`FAIL ${name}: ${String(error)}`);await page.screenshot({path:join(outputDir,name+"-failure.png")});}
    finally{await page.unrouteAll({behavior:"ignoreErrors"});await context.close();}
  }
}finally{
  await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));
  await writeFile(join(outputDir,"results.json"),JSON.stringify({outputDir,fixture,results,failures,errors,requests},null,2));
  console.log(JSON.stringify({outputDir,results,failures,errors},null,2));
}
assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);assert.equal(results.length,3);
