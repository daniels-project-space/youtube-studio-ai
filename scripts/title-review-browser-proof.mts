/** Replay a saved paid title decision through the REAL LivePipeline -> StageRow
 * components. Local read-only fixture, not a production run or a new model call.
 * Uses the project's compiled global styles/fonts and genuine CSS modules.
 */
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { chromium } from "playwright";

const project = process.cwd();
const require = createRequire(import.meta.url);
const { build } = require(createRequire(require.resolve("tsx")).resolve("esbuild")) as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: { path: string; contents: Uint8Array }[] }>;
};
const evidencePath = process.argv[2] ?? "test-fixtures/title-pilot-2026-09/chalk-current.jsonl";
const rows = (await readFile(evidencePath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
const decision = rows.find((row) => row.result)?.result?.decision;
assert.equal(decision?.version, "title-decision/v1", "needs a real saved decision, not a title invented by the proof");
const outputDir = await mkdtemp(join(tmpdir(), "ysa-title-review-browser-"));
const result = await build({ bundle: true, write: false, platform: "browser", jsx: "automatic",
  outfile: join(outputDir, "proof.js"), define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  stdin: { resolveDir: project, sourcefile: "title-review-proof.tsx", loader: "tsx", contents: `
    import {createRoot} from "react-dom/client";
    import {LivePipeline} from "./src/components/LivePipeline";
    const decision = ${JSON.stringify(decision)};
    const mode = new URLSearchParams(location.search).get("mode");
    const outputs = mode === "legacy" ? {title:decision.title,description:"Legacy saved package"} : {
      title: mode === "changed" ? "A replacement title outside this review" : decision.title,
      titleDecision: mode === "malformed" ? {...decision,rankings:[]} : decision
    };
    createRoot(document.getElementById("root")).render(<LivePipeline planSource="frozen"
      nodes={[{block:"metadata",stage:{block:"metadata",status:"ok",outputs,cost:0}}]} />);
  ` } });
const files = new Map<string, Uint8Array>();
for (const output of result.outputFiles) files.set(output.path.endsWith(".css") ? "/proof.css" : "/proof.js", output.contents);
const staticRoot = resolve(project, ".next/static");
const styles = (await readdir(join(staticRoot, "chunks"))).filter((name) => name.endsWith(".css"));
assert.ok(styles.length, "run the production build first; do not substitute made-up theme tokens");
const compiledPage = await readFile(join(project, ".next/server/app/index.html"), "utf8");
const htmlTag = compiledPage.match(/<html\b[^>]*>/)?.[0];
assert.ok(htmlTag, "reuse the actual layout's font-variable classes");
const html = `<!doctype html>${htmlTag}<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Saved title review — local component proof</title>
  ${styles.map((name) => `<link rel="stylesheet" href="/_next/static/chunks/${name}">`).join("")}
  <link rel="stylesheet" href="/proof.css"><style>body{padding:24px}main{max-width:1100px;margin:auto}h1{font:600 1.1rem var(--font-sans);margin-bottom:24px}@media(max-width:600px){body{padding:12px}}</style>
  </head><body><main><h1>Saved title review · local replay</h1><div id="root"></div></main><script src="/proof.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? "/", "http://local").pathname;
    let bytes = files.get(path), contentType = path.endsWith(".css") ? "text/css" : "application/javascript";
    if (path.startsWith("/_next/static/")) {
      const local = resolve(staticRoot, path.slice("/_next/static/".length));
      assert.ok(local.startsWith(staticRoot + "/"));
      bytes = await readFile(local);
      contentType = extname(local) === ".css" ? "text/css" : "font/woff2";
    }
    if (path === "/") { bytes = Buffer.from(html); contentType = "text/html"; }
    res.writeHead(bytes ? 200 : 404, { "Content-Type": contentType }); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: process.env.UI_AUDIT_CHROMIUM ?? "/snap/bin/chromium", args: ["--no-sandbox"] });
const errors: string[] = [], externalRequests: string[] = [], results: unknown[] = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => { errors.push(error.message); console.error("Browser error:", error.message); });
  page.setDefaultTimeout(10000);
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(base + "/")) return route.continue();
    externalRequests.push(route.request().url()); return route.abort();
  });
  for (const [name, width, fontSize] of [["desktop", 1440, 16], ["mobile", 390, 16], ["large-text", 390, 32]] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base);
    await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
    await page.getByRole("button", { name: /Metadata/ }).click();
    await page.getByRole("button", { name: /Metadata/ }).last().click();
    const review = page.getByRole("region", { name: "Saved title review" });
    await review.waitFor();
    assert.equal(await review.getByText(decision.title, { exact: true }).count(), 1);
    assert.equal(await page.locator("details[open]").count(), 0);
    await page.screenshot({ path: join(outputDir, `${name}-selected.png`), fullPage: true });
    if (fontSize === 32) await page.screenshot({ path: join(outputDir, "large-text-viewport.png") });
    const compare = review.locator("summary");
    await compare.focus(); await page.keyboard.press("Enter");
    assert.equal(await review.locator("details[open]").count(), 1, "keyboard disclosure must work");
    assert.equal(await review.locator("li").count(), decision.candidates.length - 1);
    await page.screenshot({ path: join(outputDir, `${name}-compared.png`), fullPage: true });
    const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll("main *")].filter((el) => el.getBoundingClientRect().right > innerWidth)
        .slice(0, 12).map((el) => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width })),
      controls: [...document.querySelectorAll("summary")].map((el) => ({ label: el.textContent, height: el.getBoundingClientRect().height })) }));
    if (geometry.document > geometry.viewport) console.error(JSON.stringify({ name, geometry }));
    assert.ok(geometry.document <= geometry.viewport, `${name}: horizontal overflow`);
    assert.ok(geometry.controls.every((control) => control.height >= 44));
    results.push({ name, ...geometry });
  }
  for (const mode of ["changed", "malformed", "legacy"]) {
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(base + "?mode=" + mode);
    await page.getByRole("button", { name: /Metadata/ }).click();
    await page.getByRole("button", { name: /Metadata/ }).last().click();
    if (mode === "changed") await page.getByText(/saved package title differs/).waitFor();
    if (mode === "malformed") { await page.getByText(/incomplete or unsupported/).waitFor(); assert.equal(await page.getByText("Selected title", { exact: true }).count(), 0); }
    if (mode === "legacy") { assert.equal(await page.getByRole("region", { name: "Saved title review" }).count(), 0); await page.getByText(/Legacy saved package/).waitFor(); }
    if (mode !== "legacy") { await page.getByText("Technical data", { exact: true }).click(); assert.ok(await page.locator("pre").isVisible()); }
    await page.screenshot({ path: join(outputDir, `${mode}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  await writeFile(join(outputDir, "results.json"), JSON.stringify({ evidencePath, title: decision.title, results, errors, externalRequests }, null, 2));
  console.log(JSON.stringify({ outputDir, evidencePath, results, errors, externalRequests }, null, 2));
} finally { await browser.close(); await new Promise<void>((done) => server.close(() => done())); }
