/** Read-only follow-up for the Golden catalog's evidence/admission subpanels. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { MINIMUM_VIDEO_FOUNDATION_TEMPLATE } from "../src/engine/minimumVideoFoundation";

const production="https://youtube-studio-ai.vercel.app",base=process.env.UI_PROOF_BASE??production;
assert.ok([production,"http://127.0.0.1:3312"].includes(base));
const outputDir=await mkdtemp(join(tmpdir(),"ysa-golden-evidence-"));
const browser=await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox"]});
const results:unknown[]=[],failures:string[]=[],errors:string[]=[];
try {
  for(const [name,width,font] of [["desktop",1440,16],["desktop-large",1440,32],["tablet",768,16],["tablet-large",768,32],["mobile",390,16],["mobile-large",390,32],["small-phone",320,16]] as const) {
    const context=await browser.newContext({viewport:{width,height:1000}});
    try {
      const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
      if(base!==production)for(const endpoint of ["/api/auth/convex-token","/api/asset-url"]) {
        await page.route(`${base}${endpoint}*`,async route=>{
          assert.equal(route.request().method(),"GET");const url=new URL(route.request().url());
          await route.fulfill({response:await context.request.get(production+url.pathname+url.search)});
        });
      }
      await page.goto(base+"/golden",{waitUntil:"domcontentloaded"});
      await page.getByRole("heading",{name:"Golden modules",level:1,exact:true}).waitFor({timeout:45000});
      await page.evaluate(size=>{document.documentElement.style.fontSize=`${size}px`;},font);
      await page.evaluate(()=>document.fonts.ready);
      for(const [label,key] of [["Golden evidence and channel admission truth","evidence"],["Universal video foundation","foundation"]]) {
        const panel=page.getByLabel(label,{exact:true}),summary=panel.locator(":scope > summary");
        await summary.focus();await page.keyboard.press("Enter");assert.notEqual(await panel.getAttribute("open"),null);
        const nested=await panel.locator("details").all();
        for(const item of nested)if(await item.getAttribute("open")===null){await item.locator(":scope > summary").focus();await page.keyboard.press("Enter");assert.notEqual(await item.getAttribute("open"),null);}
        const issues=await panel.evaluate(root=>{
          const box=root.getBoundingClientRect();
          return [...root.querySelectorAll<HTMLElement>("summary,strong,small,p,h3,li,[class*='admissionList'] span")].filter(node=>{
            const rect=node.getBoundingClientRect();if(!rect.width || !rect.height)return false;
            const range=document.createRange();range.selectNodeContents(node);const text=range.getBoundingClientRect();
            const style=getComputedStyle(node);
            return text.left<box.left-1 || text.right>box.right+1 || text.bottom>box.bottom+1
              || (/hidden|clip/.test(style.overflowX) && node.scrollWidth>node.clientWidth+1)
              || (/hidden|clip/.test(style.overflowY) && node.scrollHeight>node.clientHeight+1);
          }).map(node=>({text:node.textContent?.slice(0,140),class:node.className}));
        });
        if(issues.length)failures.push(`${name}/${key}: ${issues.length} clipped/out-of-panel regions`);
        if(key==="foundation") {
          const stages=panel.locator("ol > li");
          assert.equal(await stages.count(),MINIMUM_VIDEO_FOUNDATION_TEMPLATE.length);
          assert.deepEqual(await stages.locator("strong").allTextContents(),MINIMUM_VIDEO_FOUNDATION_TEMPLATE.map(stage=>stage.title),"every displayed foundation stage comes from the real engine registry");
          const detached=await stages.evaluateAll(nodes=>nodes.filter(node=>{
            const title=node.querySelector("strong")!,copy=node.querySelector("small")!;
            const titleText=document.createRange(),copyText=document.createRange();
            titleText.selectNodeContents(title);copyText.selectNodeContents(copy);
            return copyText.getBoundingClientRect().top-titleText.getBoundingClientRect().bottom>10;
          }).map(node=>node.querySelector("strong")?.textContent));
          if(detached.length)failures.push(`${name}: detached foundation descriptions: ${detached.join(", ")}`);
        }
        await summary.evaluate(node=>{node.scrollIntoView({block:"start",behavior:"instant"});window.scrollBy(0,-((document.querySelector(".studio-topbar")?.getBoundingClientRect().height??160)+12));});
        await page.screenshot({path:join(outputDir,`${name}-${key}.png`)});
        results.push({name,key,nestedCount:nested.length,issues});
        await summary.focus();await page.keyboard.press("Enter");assert.equal(await panel.getAttribute("open"),null);
      }
    } finally {await Promise.all(context.pages().map(page=>page.unrouteAll({behavior:"ignoreErrors"})));await context.close();}
  }
  await writeFile(join(outputDir,"results.json"),JSON.stringify({base,results,failures,errors},null,2));
  console.log(JSON.stringify({outputDir,failures,errors}));
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
} finally {await browser.close();}
