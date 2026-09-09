/** Actual room component, local owner/viewer fixture, no external calls or real mutations. */
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { chromium } from "playwright";

const project = process.cwd(), themeProject = process.env.UI_THEME_BUILD ?? project;
const require = createRequire(import.meta.url);
type FixtureBuilder = {
  onResolve: (filter: {filter: RegExp}, handler: (args: {path: string}) => {path: string; namespace: string}) => void;
  onLoad: (filter: {filter: RegExp; namespace: string}, handler: (args: {path: string}) => {contents: string; resolveDir: string}) => void;
};
const { build } = require(createRequire(require.resolve("tsx")).resolve("esbuild")) as {
  build: (options: Record<string, unknown>) => Promise<{outputFiles: {path: string; contents: Uint8Array}[]}>;
};
const outputDir = await mkdtemp(join(tmpdir(), "ysa-room-component-"));
const fixtureModules: Record<string, string> = {
  "convex/react": `import {getFunctionName} from "convex/server";
    export const useMutation = (fn) => async (args) => {window.fixtureCalls.push({name:getFunctionName(fn),args}); return {lockedSkipped:0};};`,
  "./OperationsAccess": `export const useOperationsAccess = () => new URLSearchParams(location.search).get("role") || "owner";`,
  "@/lib/owner-context": `export const useOwnerId = () => "owner_fixture";`,
  "@/lib/asset-url": `export const useAssetUrlState = () => ({status:"error",url:null}); export const invalidateAssetUrl = () => {};`,
};
const bundle = await build({ bundle: true, write: false, platform: "browser", jsx: "automatic",
  outfile: join(outputDir, "proof.js"), define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  plugins: [{ name: "explicit-ui-fixture-boundaries", setup(builder: FixtureBuilder) {
    builder.onResolve({ filter: /^(convex\/react|\.\/OperationsAccess|@\/lib\/(owner-context|asset-url))$/ }, (args) => ({ path: args.path, namespace: "room-fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "room-fixture" }, (args) => ({ contents: fixtureModules[args.path], resolveDir: project }));
  } }],
  stdin: { resolveDir: project, sourcefile: "room-proof.tsx", loader: "tsx", contents: `
    import {useState} from "react"; import {createRoot} from "react-dom/client";
    import {ChannelFolderWorkspace} from "./src/components/ChannelFolderWorkspace";
    window.fixtureCalls = [];
    const folders = [{_id:"folder-history",name:"History & Archives"},{_id:"folder-ocean",name:"Quiet ocean study sessions"}];
    const channels = [1,2,3].map(i=>({_id:"channel-"+i,name:"History "+i,folder:folders[0].name,identity:{palette:["#654a2d","#13151d"]}}));
    function Proof(){const [selected,setSelected]=useState(null);return <div className="studio-shell"><main className="studio-main">
      <h1>Channel rooms · local component fixture</h1>
      <ChannelFolderWorkspace channels={channels} folders={folders} selectedFolder={selected} standaloneCount={11} onSelect={setSelected}/>
    </main></div>};createRoot(document.getElementById("root")).render(<Proof/>);
  ` } });
const files = new Map<string, Uint8Array>();
for (const file of bundle.outputFiles!) files.set(file.path.endsWith(".css") ? "/proof.css" : "/proof.js", file.contents);
const staticRoot = resolve(themeProject, ".next/static");
const styles = (await readdir(join(staticRoot, "chunks"))).filter((name) => name.endsWith(".css"));
const layout = await readFile(join(themeProject, ".next/server/app/index.html"), "utf8");
const htmlTag = layout.match(/<html\b[^>]*>/)?.[0]; assert.ok(styles.length && htmlTag, "needs an actual compiled app theme");
const html = `<!doctype html>${htmlTag}<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  ${styles.map((name) => `<link rel="stylesheet" href="/_next/static/chunks/${name}">`).join("")}
  <link rel="stylesheet" href="/proof.css"></head><body><div id="root"></div><script src="/proof.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? "/", "http://local").pathname;
    let bytes = files.get(path), type = path.endsWith(".css") ? "text/css" : "application/javascript";
    if (path.startsWith("/_next/static/")) {
      const local = resolve(staticRoot, path.slice("/_next/static/".length)); assert.ok(local.startsWith(staticRoot + "/"));
      bytes = await readFile(local); type = extname(local) === ".css" ? "text/css" : "font/woff2";
    }
    if (path === "/") { bytes = Buffer.from(html); type = "text/html"; }
    res.writeHead(bytes ? 200 : 404, { "Content-Type": type }); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const failures: string[] = [], errors: string[] = [], external: string[] = [], results: unknown[] = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(base + "/")) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  for (const [name, width, font] of [["desktop",1440,16],["mobile",390,16],["large-text",390,32]] as const) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(base);
    await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, font);
    const region = page.getByRole("region", { name: "Rooms" }); await region.waitFor(); await page.evaluate(() => document.fonts.ready);
    const main = region.getByRole("button", { name: /Main channels/ });
    const title = await main.locator("strong").evaluate((node) => ({client:node.clientWidth,scroll:node.scrollWidth}));
    if (title.scroll > title.client + 1) failures.push(`${name}: Main channels label is truncated`);
    await region.locator("summary[aria-label='Manage History & Archives']").click();
    await page.waitForFunction(() => {
      const room=document.querySelector("details[open]")?.closest("article"), shelf=room?.parentElement;
      if(!room || !shelf) return false;
      const box=room.getBoundingClientRect(), container=shelf.getBoundingClientRect();
      return box.left >= container.left - 1 && box.right <= container.right + 1;
    });
    const rename = region.getByRole("button", { name: "Rename", exact: true });
    const exposed = await rename.evaluate((node) => { const box=node.getBoundingClientRect(); return node.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)); });
    await page.screenshot({ path: join(outputDir, `${name}-menu.png`), fullPage: true });
    if (!exposed) failures.push(`${name}: room-management menu is clipped or covered`);
    if (exposed) {
      await rename.click(); await region.getByRole("textbox", { name: "Rename History & Archives" }).fill("Archive room");
      const form = region.locator("form");
      const inputsFit = await form.evaluate(node => {
        const box=node.getBoundingClientRect();
        return [...node.querySelectorAll("input,button")].every(control=>{
          const target=control.getBoundingClientRect();
          return target.left>=box.left-1 && target.right<=box.right+1 && target.height>=44;
        });
      });
      await page.screenshot({path:join(outputDir,`${name}-rename.png`),fullPage:true});
      if(!inputsFit) failures.push(`${name}: rename controls overflow or have undersized targets`);
      await region.getByRole("button", { name: "Save", exact: true }).click();
      const calls = await page.evaluate(() => (window as unknown as {fixtureCalls:unknown[]}).fixtureCalls);
      assert.deepEqual(calls,[{name:"folders:rename",args:{ownerId:"owner_fixture",folderId:"folder-history",name:"Archive room"}}]);
    }
    await main.click(); assert.equal(await main.getAttribute("aria-pressed"),"true");
    results.push({name,title,managementExposed:exposed});
  }
  await page.goto(base + "?role=viewer");
  assert.equal(await page.getByRole("button", { name: "New room" }).isDisabled(),true);
  assert.equal(await page.locator("summary[aria-label^='Manage ']").count(),0);
  assert.deepEqual(await page.evaluate(() => (window as unknown as {fixtureCalls:unknown[]}).fixtureCalls),[]);
  await writeFile(join(outputDir,"results.json"),JSON.stringify({results,failures,errors,external},null,2));
  console.log(JSON.stringify({outputDir,results,failures,errors,external},null,2));
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]); assert.deepEqual(failures,[]);
} finally { await browser.close(); await new Promise<void>((done) => server.close(() => done())); }
