/** Actual React preview + asset hook in Chromium; local retained media only. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const esbuild = require(require.resolve("esbuild", {paths:[require.resolve("tsx")]})) as {
  build(options:Record<string,unknown>):Promise<{outputFiles:{contents:Uint8Array}[]}>;
};
type FixtureBuild = {
  onLoad(options:{filter:RegExp}, load:()=>{loader:string;contents:string}):void;
  onResolve(options:{filter:RegExp}, resolve:(args:{path:string})=>{path:string}):void;
};
const imagePath = process.env.PREVIEW_TEST_IMAGE;
const videoPath = process.env.PREVIEW_TEST_VIDEO;
assert.ok(imagePath && videoPath, "provide existing local PNG and >=15-second MP4 fixtures");
const [imageBytes, videoBytes] = await Promise.all([readFile(imagePath), readFile(videoPath)]);
const outputDir = await mkdtemp(join(tmpdir(), "ysa-media-preview-proof-"));
const compiled = await esbuild.build({
  absWorkingDir: process.cwd(), bundle:true, write:false, format:"iife", platform:"browser", jsx:"automatic",
  stdin:{resolveDir:process.cwd(), loader:"tsx", contents:`
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {flushSync} from 'react-dom';
    import {MediaPreview} from './src/components/MediaPreview';
    import {useAssetUrlState} from './src/lib/asset-url';
    window.previewErrors=[];
    function Probe({assetKey,tag}) {
      const state=useAssetUrlState(assetKey,()=>window.previewErrors.push(tag));
      return <output data-probe-status={state.status}>{state.status}</output>;
    }
    function Fixture() {
      const [props,setProps] = useState({alt:'Preview fixture'});
      const [copies,setCopies] = useState(1);
      window.setPreviewProps = (value,count=1) => flushSync(()=>{setProps({...value,alt:'Preview fixture'});setCopies(count)});
      return props.probe ? <Probe {...props}/> : <>{Array.from({length:copies},(_,index)=><MediaPreview key={index} {...props} />)}</>;
    }
    createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);
  `},
  plugins:[{name:"fixture-css", setup(build:FixtureBuild) {
    build.onLoad({filter:/\.module\.css$/}, () => ({loader:"js", contents:"export default new Proxy({}, {get:(_,key)=>String(key)})"}));
    build.onResolve({filter:/^@\//}, args => ({path:resolve("src",args.path.slice(2)+".ts")}));
  }}],
});
const calls:string[] = [];
const generations=new Map<string,number>();
const server=createServer(async (req,res)=>{
  const url=new URL(req.url ?? "/", "http://fixture.invalid");
  if (url.pathname === "/") {res.setHeader("Content-Type","text/html");res.end('<div id="root" style="max-width:600px"></div><script src="/bundle.js"></script>');return;}
  if (url.pathname === "/bundle.js") {res.setHeader("Content-Type","application/javascript");res.end(compiled.outputFiles[0].contents);return;}
  if (url.pathname === "/api/asset-url") {
    const key=url.searchParams.get("key") ?? "";calls.push(key);
    generations.set(key,(generations.get(key) ?? 0)+1);
    if (key.endsWith("-denied")) {res.statusCode=403;res.end();return;}
    res.setHeader("Content-Type","application/json");
    const media=key.endsWith(".mp4") ? "/master.mp4" : "/thumbnail.png";
    res.end(JSON.stringify({url:`${media}?receipt=${encodeURIComponent(key)}-${generations.get(key)}`}));return;
  }
  const bytes=url.pathname === "/thumbnail.png" ? imageBytes : url.pathname === "/master.mp4" ? videoBytes : null;
  if (!bytes) {res.statusCode=404;res.end();return;}
  res.setHeader("Content-Type",url.pathname.endsWith(".mp4") ? "video/mp4" : "image/png");
  res.setHeader("Accept-Ranges","bytes");
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    const start=Number(range[1]),end=Math.min(bytes.length-1,range[2] ? Number(range[2]) : bytes.length-1);
    if (start>end) {res.statusCode=416;res.end();return;}
    res.statusCode=206;res.setHeader("Content-Range",`bytes ${start}-${end}/${bytes.length}`);
    res.setHeader("Content-Length",end-start+1);res.end(bytes.subarray(start,end+1));return;
  }
  res.setHeader("Content-Length",bytes.length);res.end(bytes);
});
await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
const address=server.address();assert.ok(address && typeof address !== "string");
const base=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox"]});
const failures:string[] = [], results:unknown[] = [], errors:string[] = [];
try {
  const page=await browser.newPage({viewport:{width:720,height:500},reducedMotion:"reduce"});
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/*",route=>new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(base);
  await page.waitForFunction(()=>typeof (window as unknown as {setPreviewProps?:unknown}).setPreviewProps === "function");
  const cases = [
    {name:"stored image",props:{assetKey:"stored.png",videoStillKey:"unused.mp4"},keys:["stored.png"],element:"img",state:"ready"},
    {name:"reviewed image",props:{reviewedSrc:"/thumbnail.png?reviewed",assetKey:"hidden.png",videoStillKey:"hidden.mp4"},keys:[],element:"img",state:"ready"},
    {name:"review failure to stored image",props:{reviewedSrc:"/missing-review-1.png",assetKey:"recovery.png",videoStillKey:"unused-2.mp4"},keys:["recovery.png"],element:"img",state:"ready"},
    {name:"review failure to native master",props:{reviewedSrc:"/missing-review-2.png",videoStillKey:"recovery.mp4"},keys:["recovery.mp4"],element:"video",state:"ready"},
    {name:"direct native master",props:{videoStillKey:"direct.mp4"},keys:["direct.mp4"],element:"video",state:"ready"},
    {name:"denied stored source",props:{assetKey:"source-denied"},keys:["source-denied"],element:null,state:"unavailable"},
    {name:"source failure to explicit fallback",props:{assetKey:"fallback-denied",fallbackSrc:"/thumbnail.png?fallback"},keys:["fallback-denied"],element:"img",state:"ready"},
  ];
  for (const fixture of cases) {
    calls.length=0;
    await page.evaluate(props=>(window as unknown as {setPreviewProps:(props:unknown)=>void}).setPreviewProps(props),fixture.props);
    try {
      await page.waitForFunction(state=>document.querySelector("[data-preview-state]")?.getAttribute("data-preview-state") === state,fixture.state,{timeout:12000});
      // The expected selected native element and its decoded source must exist;
      // a previous ready render alone cannot satisfy this case.
      if (fixture.element === "video") await page.waitForFunction(()=>{const v=document.querySelector("video");return v && v.readyState>=2 && v.paused && Math.abs(v.currentTime-15)<0.1;},undefined,{timeout:12000});
      if (fixture.element === "img") await page.waitForFunction(()=>{const i=document.querySelector("img");return i && i.complete && i.naturalWidth>0;},undefined,{timeout:12000});
      assert.deepEqual(calls,fixture.keys,fixture.name+": only selected source signs");
      assert.equal(await page.locator("img").count(),fixture.element === "img" ? 1 : 0);
      assert.equal(await page.locator("video").count(),fixture.element === "video" ? 1 : 0);
      assert.equal(await page.locator('[aria-busy="true"]').count(),0);
      assert.equal((await page.locator("#root").innerText()).includes("Loading preview"),false);
      results.push({name:fixture.name,keys:[...calls],element:fixture.element,state:fixture.state});
      if (fixture.element === "video") await page.screenshot({path:join(outputDir,fixture.name.replaceAll(" ","-")+".png")});
    } catch(error) {failures.push(`${fixture.name}: ${String(error)}`);}
  }
  calls.length=0;
  const renderCopies = (count:number) => page.evaluate(count=>(window as unknown as {
    setPreviewProps:(props:unknown,count:number)=>void;
  }).setPreviewProps({assetKey:"coalesced.png"},count),count);
  const waitCopies = async (count:number) => {
    await page.waitForFunction(count=>document.querySelectorAll("img").length===count,count,{timeout:12000});
    // Newly appended images below the viewport are deliberately lazy. Make
    // each eligible before treating delayed decoding as an application fault.
    for (const image of await page.locator("img").all()) await image.scrollIntoViewIfNeeded();
    await page.waitForFunction(count=>{
      const images=[...document.querySelectorAll("img")];
      return images.length===count && images.every(i=>i.complete && i.naturalWidth>0) &&
        document.querySelectorAll('[data-preview-state="ready"]').length===count;
    },count,{timeout:12000});
  };
  await renderCopies(6);await waitCopies(6);
  try { assert.deepEqual(calls,["coalesced.png"],"six concurrent previews share one signing request");
    results.push({name:"six concurrent previews",requests:calls.length});
  } catch(error) {failures.push(String(error));}
  const originalSrc=await page.locator("img").first().getAttribute("src");
  calls.length=0;
  await page.clock.setFixedTime(new Date(Date.now()+10*60_000));
  await renderCopies(7);await waitCopies(7);
  // Force the old instances to render after the new mount populated the cache.
  await renderCopies(7);await waitCopies(7);
  try {
    assert.deepEqual(calls,["coalesced.png"],"one fresh link for an expired new mount");
    assert.equal(await page.locator("img").first().getAttribute("src"),originalSrc,
      "a new cache receipt must not reset media already mounted with a valid URL");
    assert.notEqual(await page.locator("img").last().getAttribute("src"),originalSrc);
    results.push({name:"expired cache/new mount, stable existing media",requests:calls.length});
  } catch(error) {failures.push(String(error));}
  calls.length=0;
  const setProbe = (tag:string) => page.evaluate(tag=>(window as unknown as {
    setPreviewProps:(props:unknown)=>void;
  }).setPreviewProps({probe:true,assetKey:"callback-denied",tag}),tag);
  await setProbe("initial");
  await page.locator('[data-probe-status="error"]').waitFor({timeout:12000});
  for(let index=0;index<5;index++) await setProbe(`new-callback-${index}`);
  try {
    assert.deepEqual(calls,["callback-denied"],"callback identity alone cannot create signing retries");
    assert.deepEqual(await page.evaluate(()=>(window as unknown as {previewErrors:string[]}).previewErrors),["initial"]);
    results.push({name:"callback rerenders do not refetch",requests:calls.length});
  } catch(error) {failures.push(String(error));}
  await page.evaluate(()=>(window as unknown as {setPreviewProps:(props:unknown)=>void}).setPreviewProps({}));
  const report={outputDir,results,failures,errors};
  await writeFile(join(outputDir,"results.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
} finally {await browser.close();await new Promise<void>((done,reject)=>server.close(error=>error ? reject(error) : done()));}
