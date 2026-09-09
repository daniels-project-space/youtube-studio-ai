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
    function Fixture() {
      const [props,setProps] = useState({alt:'Preview fixture'});
      window.setPreviewProps = value => flushSync(()=>setProps({...value,alt:'Preview fixture'}));
      return <MediaPreview {...props} />;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `},
  plugins:[{name:"fixture-css", setup(build:FixtureBuild) {
    build.onLoad({filter:/\.module\.css$/}, () => ({loader:"js", contents:"export default new Proxy({}, {get:(_,key)=>String(key)})"}));
    build.onResolve({filter:/^@\//}, args => ({path:resolve("src",args.path.slice(2)+".ts")}));
  }}],
});
const calls:string[] = [];
const server=createServer(async (req,res)=>{
  const url=new URL(req.url ?? "/", "http://fixture.invalid");
  if (url.pathname === "/") {res.setHeader("Content-Type","text/html");res.end('<div id="root" style="max-width:600px"></div><script src="/bundle.js"></script>');return;}
  if (url.pathname === "/bundle.js") {res.setHeader("Content-Type","application/javascript");res.end(compiled.outputFiles[0].contents);return;}
  if (url.pathname === "/api/asset-url") {
    const key=url.searchParams.get("key") ?? "";calls.push(key);
    if (key.endsWith("-denied")) {res.statusCode=403;res.end();return;}
    res.setHeader("Content-Type","application/json");
    res.end(JSON.stringify({url:key.endsWith(".mp4") ? "/master.mp4" : "/thumbnail.png"}));return;
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
  const report={outputDir,results,failures,errors};
  await writeFile(join(outputDir,"results.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
} finally {await browser.close();await new Promise<void>((done,reject)=>server.close(error=>error ? reject(error) : done()));}
