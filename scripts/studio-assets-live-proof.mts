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
const results: unknown[] = [], failures: string[] = [], errors: string[] = [], catalogRequests: string[] = [];
try {
  for (const [name,width,font] of [["desktop",1440,16],["desktop-large",1440,32],["phone",390,16],["phone-large",390,32],["small-phone",320,16]] as const) {
    const context = await browser.newContext({viewport:{width,height:1000}});
    try {
      const page = await context.newPage(); page.on("pageerror",error=>errors.push(error.message));
      page.on("request",request=>{if(new URL(request.url()).pathname==="/api/studio-assets")catalogRequests.push(request.method());});
      if(base!==production) for(const endpoint of ["/api/auth/convex-token","/api/asset-url","/api/operations/elevation"]) {
        await page.route(`${base}${endpoint}*`,async route=>{
          assert.equal(route.request().method(),"GET");const url=new URL(route.request().url());
          await route.fulfill({response:await context.request.get(production+url.pathname+url.search)});
        });
      }
      await page.goto(base+"/studio-assets",{waitUntil:"domcontentloaded"});
      const title=page.getByRole("heading",{name:"Studio assets",level:1,exact:true}); await title.waitFor({timeout:45000});
      await page.getByText("Read-only catalog",{exact:true}).waitFor();
      await page.waitForFunction(() => !(document.body.innerText ?? "").includes("Loading Studio asset registry…"), { timeout: 45000 });
      await page.evaluate(size=>{document.documentElement.style.fontSize=`${size}px`;},font); await page.evaluate(()=>document.fonts.ready);
      const content=title.locator("xpath=ancestor::*[contains(@class,'page')][1]");
      const text=await content.innerText();
      if(/\b00\b|\bUnattested\b/.test(text))failures.push(`${name}: unloaded inventory reported as zero or an unverified runtime`);
      if(await page.getByRole("link",{name:"Verify with YouTube",exact:true}).count()!==0)failures.push(`${name}: stale owner-verification gate is still rendered`);
      const grids=page.locator("[class*='catalogGrid']");
      if(await grids.count()!==2)failures.push(`${name}: expected two compact read-only catalog grids`);
      const columns=await grids.first().evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(" ").filter(Boolean).length).catch(()=>0);
      // Large-text mode may intentionally collapse to one column to preserve
      // legibility; the compact multi-column claim applies to normal desktop.
      if(width>=1000 && font===16 && columns<3)failures.push(`${name}: read-only catalog only exposes ${columns} desktop columns`);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      if(overflow)failures.push(`${name}: horizontal page overflow`);
      // Capture the actual scrolled viewport: full-page stitching relocates
      // fixed navigation and misrepresents the focused button's clearance.
      await page.screenshot({path:join(outputDir,`${name}.png`)});
      results.push({name,columns,overflow});
    } finally {await Promise.all(context.pages().map(page=>page.unrouteAll({behavior:"ignoreErrors"})));await context.close();}
  }
  await writeFile(join(outputDir,"results.json"),JSON.stringify({base,results,failures,errors,catalogRequests},null,2));
  console.log(JSON.stringify({outputDir,results,failures,errors,catalogRequests},null,2));
  assert.deepEqual(errors,[]);assert.deepEqual(catalogRequests.filter(method=>method!=="GET"),[]);assert.deepEqual(failures,[]);
} finally {await browser.close();}
