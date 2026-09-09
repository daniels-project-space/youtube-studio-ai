/** Follow the catalog's real links; no owner action, rendering or publishing. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const base="https://youtube-studio-ai.vercel.app",outputDir=await mkdtemp(join(tmpdir(),"ysa-golden-destinations-"));
const browser=await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox"]});
const results:unknown[]=[],errors:string[]=[],failures:string[]=[];
try {
  for(const [name,width] of [["desktop",1440],["phone",390]] as const) {
    const context=await browser.newContext({viewport:{width,height:1000}});
    try {
      const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
      await page.goto(base+"/golden",{waitUntil:"domcontentloaded"});
      await page.getByRole("heading",{name:"Golden modules",level:1,exact:true}).waitFor({timeout:45000});
      const hrefs=await page.locator("details[data-module-key] a").evaluateAll(nodes=>[...new Set(nodes.map(node=>node.getAttribute("href")))]);
      assert.ok(hrefs.length>0,"real catalog destinations are required");
      for(const href of hrefs) {
        assert.ok(typeof href==="string" && href.startsWith("/") && !href.startsWith("/api/"),"only read-only app destinations");
        const link=page.locator(`details[data-module-key] a[href='${href}']`).first();
        const category=link.locator("xpath=ancestor::details[@aria-label][1]");
        if(await category.getAttribute("open")===null)await category.locator(":scope > summary").click();
        const card=link.locator("xpath=ancestor::details[1]");
        if(await card.getAttribute("open")===null)await card.locator(":scope > summary").click();
        const label=await link.textContent();await link.click();
        await page.waitForURL(url=>url.pathname===href,{timeout:30000});
        const title=page.locator(".studio-main h1").first();
        await title.waitFor({timeout:45000});
        const titleText=(await title.textContent())?.trim();
        if(!titleText || /not found|offline|error/i.test(titleText))failures.push(`${name}/${href}: unavailable destination (${titleText})`);
        if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1))failures.push(`${name}/${href}: horizontal overflow`);
        await page.screenshot({path:join(outputDir,`${name}-${href.slice(1)}.png`)});
        results.push({name,href,label,title:titleText});
        await page.goBack({waitUntil:"domcontentloaded"});
        await page.getByRole("heading",{name:"Golden modules",level:1,exact:true}).waitFor({timeout:45000});
      }
    }finally{await context.close();}
  }
  await writeFile(join(outputDir,"results.json"),JSON.stringify({base,results,failures,errors},null,2));
  console.log(JSON.stringify({outputDir,destinations:results.length,failures,errors}));
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
}finally{await browser.close();}
