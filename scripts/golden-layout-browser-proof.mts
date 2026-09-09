/** Read-only catalog layout/interaction audit on real app components and records. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const production="https://youtube-studio-ai.vercel.app", base=process.env.UI_PROOF_BASE ?? production;
assert.ok([production,"http://127.0.0.1:3312"].includes(base));
const outputDir=await mkdtemp(join(tmpdir(),"ysa-golden-layout-"));
const browser=await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox"]});
const results:unknown[]=[], failures:string[]=[], errors:string[]=[];
try {
  for(const [name,width,font] of [["desktop-large",1440,32],["desktop",1440,16],["tablet",768,16],["mobile",390,16],["mobile-large",390,32]] as const){
    const context=await browser.newContext({viewport:{width,height:1000}});
    try {
      const page=await context.newPage(), queries:string[]=[];
      let peakLockSubscriptions=0;
      page.on("pageerror",e=>errors.push(e.message));
      page.on("websocket",socket=>{
        const active=new Map<number,string>();
        socket.on("framesent",frame=>{
          try {
            const message=JSON.parse(String(frame.payload));
            if(message.type!=="ModifyQuerySet")return;
            for(const mod of message.modifications ?? []) {
              if(mod.type==="Add") { queries.push(mod.udfPath); active.set(mod.queryId,mod.udfPath); }
              if(mod.type==="Remove")active.delete(mod.queryId);
            }
            peakLockSubscriptions=Math.max(peakLockSubscriptions,[...active.values()].filter(path=>path==="ownerModuleLocks:list").length);
          }catch{/* Not a query frame. Never retain auth frames or query arguments. */}
        });
      });
      if(base!==production)for(const endpoint of ["/api/auth/convex-token","/api/asset-url"]){
        await page.route(`${base}${endpoint}*`,async route=>{assert.equal(route.request().method(),"GET");const url=new URL(route.request().url());await route.fulfill({response:await context.request.get(production+url.pathname+url.search)});});
      }
      await page.goto(base+"/golden",{waitUntil:"domcontentloaded"});
      const heading=page.getByRole("heading",{name:"Golden modules",level:1,exact:true}); await heading.waitFor({timeout:45000});
      await page.evaluate(size=>{document.documentElement.style.fontSize=`${size}px`;},font);
      await page.evaluate(()=>document.fonts.ready);
      const main=heading.locator("xpath=ancestor::main[1]");
      const stats=page.getByLabel("Golden catalog summary");
      const metrics=await stats.evaluate(root=>[...root.children].map(node=>{
        const label=node.querySelector("span")!, value=node.querySelector("strong")!;
        const range=document.createRange();range.selectNodeContents(label);
        const a=range.getBoundingClientRect(),b=value.getBoundingClientRect(),box=node.getBoundingClientRect();
        const overlap=Math.min(a.right,b.right)>Math.max(a.left,b.left)+1 && Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1;
        return {label:label.textContent,value:value.textContent,fits:a.left>=box.left-1 && a.right<=box.right+1 && b.left>=box.left-1 && b.right<=box.right+1 && !overlap};
      }));
      if(metrics.some(metric=>!metric.fits)) failures.push(`${name}: catalog labels/counts overlap or clip`);
      await page.screenshot({path:join(outputDir,`${name}-catalog.png`)});
      const chapters=main.locator("details[aria-label$=' Golden modules']");
      for(const chapter of await chapters.all())if(await chapter.getAttribute("open")===null)await chapter.locator(":scope > summary").click();
      const cards=main.locator("details[data-module-key]");
      assert.equal(await cards.count(),Number(metrics.find(metric=>metric.label==="Catalog")?.value),"every counted module has a real card");
      const inspected:string[]=[];
      for(const card of await cards.all()){
        const key=(await card.getAttribute("data-module-key"))!;
        const closedIssues=await card.locator(":scope > summary").evaluate(root=>{
          const box=root.getBoundingClientRect();
          return [...root.querySelectorAll<HTMLElement>("[role='heading'],strong,li,[class*='moduleStatus']")].filter(node=>{
            const rect=node.getBoundingClientRect();
            return rect.width>0 && (rect.left<box.left-1 || rect.right>box.right+1 || node.scrollWidth>node.clientWidth+1 || node.scrollHeight>node.clientHeight+1);
          }).map(node=>node.textContent);
        });
        if(closedIssues.length)failures.push(`${name}/${key}: clipped collapsed copy: ${closedIssues.join(" / ")}`);
        const summary=card.locator(":scope > summary"); await summary.focus(); await page.keyboard.press("Enter");
        assert.notEqual(await card.getAttribute("open"),null,`${key}: keyboard expansion opens the actual card`);
        const issues=await card.evaluate(root=>{
          const box=root.getBoundingClientRect();
          return [...root.querySelectorAll<HTMLElement>("[class*='moduleToolbar'],[class*='moduleProtection'],[class*='moduleFacts'],[class*='moduleSummaryCopy'],[class*='modulePowerPoints'] li")].filter(node=>{
            const rect=node.getBoundingClientRect();
            return rect.width>0 && (rect.left<box.left-1 || rect.right>box.right+1 || node.scrollWidth>node.clientWidth+1);
          }).map(node=>node.className);
        });
        if(issues.length)failures.push(`${name}/${key}: ${issues.length} overflowing card regions`);
        const links=await card.locator("[class*='moduleToolbar'] a").evaluateAll(nodes=>nodes.map(node=>node.getAttribute("href")));
        assert.ok(links.every(href=>href?.startsWith("/") && href!=="#"),`${key}: real module destinations, not empty links`);
        const controls=card.locator("[class*='moduleToolbar'] button,[class*='moduleToolbar'] a");
        for(const control of await controls.all()) {
          await control.focus();
          const usable=await control.evaluate(node=>{
            node.scrollIntoView({block:"center",inline:"nearest",behavior:"instant"});
            const box=node.getBoundingClientRect(), hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
            return box.height>=44 && box.width>=44 && !!hit && node.contains(hit) && document.activeElement===node;
          });
          if(!usable)failures.push(`${name}/${key}: toolbar control not visible/focusable/44px`);
        }
        if(["metacraft","narration","topic-intel"].includes(key) || inspected.length===0){
          await summary.evaluate(node=>{
            node.scrollIntoView({block:"start",behavior:"instant"});
            const header=document.querySelector("header.studio-topbar");
            window.scrollBy(0,-((header?.getBoundingClientRect().height ?? 160)+12));
          });
          await page.screenshot({path:join(outputDir,`${name}-${key}.png`)});
        }
        await summary.focus();await page.keyboard.press("Enter");assert.equal(await card.getAttribute("open"),null);
        inspected.push(key);
      }
      assert.equal(new Set(inspected).size,inspected.length);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
      if(overflow)failures.push(`${name}: horizontal page overflow`);
      const lockQueries=queries.filter(path=>path==="ownerModuleLocks:list").length;
      // Dev Strict Mode/remounts or a socket reconnect can re-add the same query.
      // Count simultaneous IDs, not lifecycle additions, to test actual deduplication.
      if(peakLockSubscriptions!==1)failures.push(`${name}: expected one shared lock subscription, got ${peakLockSubscriptions}`);
      results.push({name,metrics,inspected,lockQueries,peakLockSubscriptions});
    } catch(error){console.error("golden-case-failed",name,error);throw error;}
    finally{await Promise.all(context.pages().map(page=>page.unrouteAll({behavior:"ignoreErrors"})));await context.close();}
  }
  await writeFile(join(outputDir,"results.json"),JSON.stringify({base,results,failures,errors},null,2));
  console.log(JSON.stringify({outputDir,cases:results.length,failures:failures.length,examples:failures.slice(0,16),errors}));
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
}finally{await browser.close();}
