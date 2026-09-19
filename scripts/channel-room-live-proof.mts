/** Read-only actual Rooms view; owner mutation behavior has a separate local fixture proof. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const production = "https://youtube-studio-ai.vercel.app", base = process.env.UI_PROOF_BASE ?? production;
assert.ok([production,"http://127.0.0.1:3312"].includes(base));
const outputDir = await mkdtemp(join(tmpdir(),"ysa-room-live-"));
const browser = await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox"]});
const results:unknown[] = [], errors:string[] = [];
try {
  for (const [name,width,font] of [["desktop",1440,16],["mobile",390,16],["large-text",390,32]] as const) {
    const context=await browser.newContext({viewport:{width,height:1000}});
    try {
      const page=await context.newPage(); page.on("pageerror",e=>errors.push(e.message));
      if(base!==production) for(const endpoint of ["/api/auth/convex-token","/api/asset-url"]) {
        await page.route(`${base}${endpoint}*`,async route=>{
          assert.equal(route.request().method(),"GET"); const url=new URL(route.request().url());
          await route.fulfill({response:await context.request.get(production+url.pathname+url.search)});
        });
      }
      await page.goto(base+"/channels",{waitUntil:"domcontentloaded"});
      const region=page.getByRole("region",{name:"Rooms"}); await region.waitFor({timeout:45000});
      await page.evaluate(size=>{document.documentElement.style.fontSize=`${size}px`;},font);
      const main=region.getByRole("button",{name:/Main channels/});
      const geometry=await main.locator("strong").evaluate(node=>({client:node.clientWidth,scroll:node.scrollWidth}));
      assert.ok(geometry.scroll<=geometry.client+1,`${name}: complete Main channels name`);
      const rooms=region.locator("article button[aria-pressed]"); assert.ok(await rooms.count()>0,"actual room records are required");
      const room=rooms.first(); await room.click();
      assert.equal(await room.getAttribute("aria-pressed"),"true","actual room selection changes the view");
      await main.click(); assert.equal(await main.getAttribute("aria-pressed"),"true");
      await page.screenshot({path:join(outputDir,`${name}.png`)});
      assert.equal(await region.locator("summary[aria-label^='Manage ']").count(),0,"viewer has no owner mutation controls");
      results.push({name,geometry,roomCount:await rooms.count()});
    } finally {
      await Promise.all(context.pages().map(page=>page.unrouteAll({behavior:"ignoreErrors"})));
      await context.close();
    }
  }
  assert.deepEqual(errors,[]);
  await writeFile(join(outputDir,"results.json"),JSON.stringify({base,results,errors},null,2));
  console.log(JSON.stringify({outputDir,base,results,errors},null,2));
} finally {await browser.close();}
