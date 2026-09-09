/** Public, read-only deployed-page proof. Never elevates access or opens private assets. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const production = "https://youtube-studio-ai.vercel.app", base = process.env.UI_PROOF_BASE ?? production;
assert.ok([production,"http://127.0.0.1:3312"].includes(base));
const outputDir = await mkdtemp(join(tmpdir(),"ysa-studio-assets-live-"));
const browser = await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox"]});
const results: unknown[] = [], failures: string[] = [], errors: string[] = [], privateRequests: string[] = [];
try {
  for (const [name,width,font] of [["desktop",1440,16],["desktop-large",1440,32],["phone",390,16],["phone-large",390,32],["small-phone",320,16]] as const) {
    const context = await browser.newContext({viewport:{width,height:1000}});
    try {
      const page = await context.newPage(); page.on("pageerror",error=>errors.push(error.message));
      page.on("request",request=>{if(new URL(request.url()).pathname==="/api/studio-assets")privateRequests.push(request.method());});
      if(base!==production) for(const endpoint of ["/api/auth/convex-token","/api/asset-url","/api/operations/elevation"]) {
        await page.route(`${base}${endpoint}*`,async route=>{
          assert.equal(route.request().method(),"GET");const url=new URL(route.request().url());
          await route.fulfill({response:await context.request.get(production+url.pathname+url.search)});
        });
      }
      await page.goto(base+"/studio-assets",{waitUntil:"domcontentloaded"});
      const title=page.getByRole("heading",{name:"Studio assets",level:1,exact:true}); await title.waitFor({timeout:45000});
      await page.getByRole("link",{name:"Verify with YouTube",exact:true}).waitFor();
      await page.evaluate(size=>{document.documentElement.style.fontSize=`${size}px`;},font); await page.evaluate(()=>document.fonts.ready);
      const content=title.locator("xpath=ancestor::*[contains(@class,'page')][1]");
      const text=await content.innerText();
      if(/\b00\b|\bUnattested\b/.test(text))failures.push(`${name}: unloaded inventory reported as zero or an unverified runtime`);
      const height=await content.evaluate(node=>node.getBoundingClientRect().height);
      if(height>(font===32?900:500))failures.push(`${name}: unavailable inventory takes ${height}px before any assets exist`);
      const link=page.getByRole("link",{name:"Verify with YouTube",exact:true});
      assert.equal(await link.getAttribute("href"),"/api/operations/authorize");
      await link.focus();assert.equal(await link.evaluate(node=>node===document.activeElement),true);
      const target=await link.evaluate(node=>{
        const box=node.getBoundingClientRect();
        // Edge midpoints stay inside rounded corners while detecting a dock
        // covering the bottom of a target whose centre is still clickable.
        const points=[[box.x+box.width/2,box.y+2],[box.x+box.width/2,box.bottom-2],[box.x+2,box.y+box.height/2],[box.right-2,box.y+box.height/2],[box.x+box.width/2,box.y+box.height/2]];
        return {height:box.height,visible:points.every(([x,y])=>node.contains(document.elementFromPoint(x,y))),top:box.top,bottom:box.bottom};
      });
      if(!target.visible || target.height<44)failures.push(`${name}: owner action is covered or smaller than 44px`);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      if(overflow)failures.push(`${name}: horizontal page overflow`);
      await page.screenshot({path:join(outputDir,`${name}.png`),fullPage:true});
      results.push({name,height,target,overflow});
    } finally {await Promise.all(context.pages().map(page=>page.unrouteAll({behavior:"ignoreErrors"})));await context.close();}
  }
  await writeFile(join(outputDir,"results.json"),JSON.stringify({base,results,failures,errors,privateRequests},null,2));
  console.log(JSON.stringify({outputDir,results,failures,errors,privateRequests},null,2));
  assert.deepEqual(errors,[]);assert.deepEqual(privateRequests,[]);assert.deepEqual(failures,[]);
} finally {await browser.close();}
