/** Actual page and access provider; only HTTP responses and Next's pathname are fixtures.
 * No production credentials, external requests, approvals, or paid work are possible.
 */
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { chromium, type Page, type Route } from "playwright";

const project = process.cwd(), themeProject = process.env.UI_THEME_BUILD ?? project;
const require = createRequire(import.meta.url);
type Builder = {
  onResolve: (filter: { filter: RegExp }, callback: () => { path: string; namespace: string }) => void;
  onLoad: (filter: { filter: RegExp; namespace: string }, callback: () => { contents: string }) => void;
};
const { build } = require(createRequire(require.resolve("tsx")).resolve("esbuild")) as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: { path: string; contents: Uint8Array }[] }>;
};
const outputDir = await mkdtemp(join(tmpdir(), "ysa-studio-assets-"));
const bundle = await build({ bundle: true, write: false, platform: "browser", jsx: "automatic",
  outfile: join(outputDir, "proof.js"), define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  plugins: [{ name: "next-pathname-only", setup(builder: Builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "pathname", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export const usePathname = () => "/studio-assets";' }));
  } }],
  stdin: { resolveDir: project, sourcefile: "studio-assets-proof.tsx", loader: "tsx", contents: `
    import {createRoot} from "react-dom/client";
    import Page from "./src/app/(app)/studio-assets/page";
    import {OperationsAccessProvider} from "./src/components/OperationsAccess";
    const root = createRoot(document.getElementById("root"));
    root.render(<OperationsAccessProvider><main className="studio-main"><Page/></main></OperationsAccessProvider>);
    window.unmountFixture = () => root.unmount();
  ` } });
const files = new Map<string, Uint8Array>();
for (const file of bundle.outputFiles) files.set(file.path.endsWith(".css") ? "/proof.css" : "/proof.js", file.contents);
const staticRoot = resolve(themeProject, ".next/static");
const theme = (await readdir(join(staticRoot, "chunks"))).filter(name => name.endsWith(".css"));
const layout = await readFile(join(themeProject, ".next/server/app/index.html"), "utf8");
const htmlTag = layout.match(/<html\b[^>]*>/)?.[0]; assert.ok(theme.length && htmlTag, "requires compiled application theme");
const html = `<!doctype html>${htmlTag}<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  ${theme.map(name => `<link rel="stylesheet" href="/_next/static/chunks/${name}">`).join("")}
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
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const hash = "a".repeat(64);
const asset = (id: string, scope = "owned_studio", status = "approved") => ({
  logicalId: id, fingerprint: id.padEnd(64, "a"), title: `Fixture ${id} image`, scope, status,
  assetKind: "source_image", identitySensitivity: scope === "channel" ? "channel" : "portable",
  compatibility: { families: ["cinematic"], contentLanes: [], moduleIds: [], treatments: [] },
  approval: { qualityScore: 96, approvedBy: "Fixture reviewer", approvedAt: 1700000000000 },
  hasRecipe: false, recipePreview: [], resource: { contentType: "image/png", byteLength: 68, contentSha256: hash },
});
const empty = { ok: true, assets: [], reusableMedia: [], candidates: [], curatedLtxCatalog: [],
  visualTreatmentCatalog: [], releaseFeedback: [], acceptedCharacterLoRAs: [], musicVideoA2Vid: null, directLtxRuntime: null };
const inventory = { ...empty,
  assets: [asset("portable"), asset("revoked", "owned_studio", "revoked"), asset("channel", "channel")],
  reusableMedia: [{ logicalId: "clip", fingerprint: hash, channelId: "channel_fixture", family: "cinematic", kind: "broll", title: "Fixture channel-only clip", status: "approved", editorialTags: [], evergreen: true, durationSec: 15, contentType: "video/mp4", qualityScore: 9.6, maximumLifetimeUses: 4, cooldownEpisodes: 2, sourceOrigin: "studio_generated" }],
  candidates: [{ candidateFingerprint: hash, title: "Fixture reviewed recipe", assetKind: "overlay_template", channelId: "channel_fixture", family: "cinematic", contentLane: "essay", visualQualityScore: 95, visualMinimumScore: 90, finalMasterSha256: hash, finalMasterReleaseCertificateFingerprint: hash }],
  directLtxRuntime: { status: "unattested", gpuSku: "RTX 5090", vramGb: 32, benchmarkedProfileCount: 0 },
  acceptedCharacterLoRAs: [{ registryIdentity: hash, characterId: "Fixture historian", characterSpecFingerprint: hash, datasetFingerprint: hash, provider: "self_hosted", adapterFlavor: "standard_lora", runtimeProfileFingerprint: hash, acceptedAt: 1700000000000 }],
  curatedLtxCatalog: [{ id: "fixture-control", label: "Fixture shot control", adapterClass: "ic_lora", purpose: "subject", controls: ["depth"], qualityMetric: "continuity", qualityPhase: "shot_control", sourceUrl: "https://example.invalid/fixture-not-a-model", baseModelVersions: ["2.5"], loaders: [], supportedFamilies: ["cinematic"], status: "descriptor_only_pending_integrity_pin", activationGate: "pinned_asset_license_workflow_guide_and_benchmark", recommendedWorkflowProfiles: [{ workflowId: "fixture-workflow", qualityRole: "shot guidance", guideKinds: ["depth"] }], executionTarget: { provider: "novita", gpuSku: "RTX 5090", minimumVramGb: 32, executor: "dedicated_comfyui_ltx" }, notes: ["Fixture descriptor; no render admission."] }],
  visualTreatmentCatalog: [{ key: "fixture-watercolor", label: "Fixture watercolor plan", description: "A continuity review profile.", activePlanningFamilies: ["cinematic"], futureFamilySeeds: ["story"], qaBenchmarkCount: 4, rendererPrerequisites: ["Exact renderer benchmark required"] }],
  musicVideoA2Vid: { id: "fixture-music", status: "not_installed", label: "Fixture music video worker", executionTarget: "Fixture GPU", currentWorkerBoundary: { workerPath: "fixture", loader: "not loaded", reason: "No approved worker fixture exists." }, requirements: ["exact benchmark"] },
};
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const failures: string[] = [], errors: string[] = [], external: string[] = [], results: unknown[] = [];
function check(condition: boolean, message: string) { if (!condition) failures.push(message); }
async function layoutCheck(page: Page, name: string) {
  const issues = await page.locator("main").evaluate(root => {
    const box = root.getBoundingClientRect();
    return [...root.querySelectorAll<HTMLElement>("h1,h2,p,dt,dd,button,a,summary")].filter(node => {
      if (!node.checkVisibility()) return false;
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node), range = document.createRange();
      range.selectNodeContents(node); const text = range.getBoundingClientRect();
      return rect.left < box.left - 1 || rect.right > box.right + 1 || text.right > box.right + 1
        || (/hidden|clip/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1)
        || ((node.matches("button,a,summary")) && rect.height < 44);
    }).map(node => ({ text: node.textContent?.slice(0,100), class: node.className }));
  });
  check(issues.length === 0, `${name}: ${JSON.stringify(issues)}`);
  await page.screenshot({ path: join(outputDir, `${name}.png`), fullPage: true });
  results.push({ name, issues });
}
try {
  for (const [name,width,font] of [["desktop",1440,16],["phone",390,16],["small",320,16],["large-text",390,32]] as const) {
    for (const state of ["viewer","checking","unavailable","loading","error","malformed","empty","ready"] as const) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
      const requests: { method: string; url: string; body: unknown }[] = [];
      const pending: Route[] = [];
      let refreshError = false, previewFailure = false, approved = false, approvalRequests = 0;
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== base) { external.push(request.url()); await route.abort(); return; }
        if (url.pathname === "/api/operations/elevation") {
          if (state === "checking") { pending.push(route); return; }
          await route.fulfill({ status: state === "unavailable" ? 503 : 200, json: { ok: true, elevated: state !== "viewer", role: state === "viewer" ? "viewer" : "owner" } }); return;
        }
        if (url.pathname === "/api/studio-assets") {
          requests.push({ method: request.method(), url: url.pathname + url.search, body: request.postDataJSON() });
          if (state === "loading") { pending.push(route); return; }
          if (url.searchParams.has("preview")) {
            if (previewFailure) { await route.fulfill({ status: 503, json: { ok: false, error: "Fixture preview unavailable" } }); return; }
            await route.fulfill({ json: { ok: true, preview: { url: base + "/fixture.png", contentType: "image/png", contentSha256: hash } } }); return;
          }
          if (request.method() === "POST") {
            approvalRequests++; approved = approvalRequests > 1;
            await route.fulfill({ status: approved ? 200 : 409, json: approved ? { ok: true } : { ok: false, error: "Fixture evidence no longer qualifies" } }); return;
          }
          if (state === "error" || refreshError) { await route.fulfill({ status: 503, json: { ok: false, error: "Fixture registry unavailable" } }); return; }
          await route.fulfill({ json: state === "malformed" ? { ok: true } : state === "empty" ? empty : approved ? { ...inventory, candidates: [] } : inventory }); return;
        }
        if (url.pathname === "/fixture.png") { await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64") }); return; }
        if (url.pathname.startsWith("/api/")) { failures.push(`unexpected request ${url.pathname}`); await route.abort(); return; }
        await route.continue();
      });
      try {
        await page.goto(base, { waitUntil: "domcontentloaded" }); await page.getByRole("heading", { name: "Studio assets", exact: true }).waitFor();
        await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, font); await page.evaluate(() => document.fonts.ready);
        if (["checking","loading"].includes(state)) await page.waitForFunction(() => document.querySelector("[aria-busy=true]"));
        else if (["viewer","unavailable"].includes(state)) {
          // The catalog is intentionally useful before owner elevation. The
          // old proof waited for an OwnerOnlyNotice link that the page no
          // longer renders; assert the actual read-only boundary instead.
          await page.getByText("Read-only catalog", { exact: true }).waitFor();
        }
        else if (state === "error") await page.getByRole("alert").waitFor();
        else await page.waitForFunction(() => !document.querySelector("[aria-busy=true]"));
        const summary = page.getByRole("list", { name: "Registry summary" });
        if (state !== "empty" && state !== "ready") {
          check(await summary.count() === 0, `${name}/${state}: inventory summary must be withheld`);
          const text = await page.locator("main").innerText();
          check(!/\b00\b|\bUnattested\b|No approved Studio assets yet|No .* records are available/.test(text), `${name}/${state}: unloaded data presented as an empty inventory or unverified runtime`);
        }
        if (["viewer","checking","unavailable"].includes(state)) {
          // Viewer mode still loads the public catalog. The server decides the
          // projection; the browser must not attempt a private inventory or
          // any mutating request before elevation.
          check(requests.length > 0 && requests.every(req => req.method === "GET" && req.url === "/api/studio-assets"),
            `${name}/${state}: viewer should request only the read-only catalog`);
        }
        if (state === "ready") {
          const summaryText = await summary.count() ? await summary.innerText() : "";
          check(/Ready to reuse\s*3/.test(summaryText), `${name}: ready count must exclude revoked assets`);
          check(/Studio-wide\s*1/.test(summaryText), `${name}: channel-only clips and revoked assets must not be portable`);
          check(await page.getByRole("article").filter({ hasText: "Fixture revoked image" }).getByRole("button").count() === 0, `${name}: revoked image offers no approved-image preview`);
          await layoutCheck(page, `${name}-inventory`);
          const preview = page.getByRole("button", { name: "Preview approved image", exact: true }).first();
          previewFailure = true; await preview.click(); await page.getByText("Fixture preview unavailable", { exact: true }).waitFor();
          check(await page.getByRole("dialog").count() === 0, `${name}: failed preview must not open a broken dialog`);
          previewFailure = false;
          await preview.click(); const dialog = page.getByRole("dialog"); await dialog.waitFor();
          await page.waitForFunction(() => (document.querySelector('[role="dialog"] img') as HTMLImageElement)?.naturalWidth === 1);
          await layoutCheck(page, `${name}-preview`);
          check(requests.some(req => req.url === `/api/studio-assets?preview=${inventory.assets[0].fingerprint}`), `${name}: preview uses exact selected fingerprint`);
          await page.keyboard.press("Escape"); check(await dialog.count() === 0, `${name}: Escape closes preview`);
          check(await preview.evaluate(node => node === document.activeElement), `${name}: preview returns focus`);
          for (const label of ["Characters", "Workers", "Catalog"]) {
            const section = page.getByRole("button", { name: new RegExp(`^${label}`) });
            await section.focus(); await page.keyboard.press("Enter"); check(await section.getAttribute("aria-pressed") === "true", `${name}: ${label} selected by keyboard`);
            await layoutCheck(page, `${name}-${label.toLowerCase()}`);
          }
          await page.getByRole("button", { name: /^Decisions/ }).or(page.getByRole("tab", { name: /Decisions/ })).click();
          await page.getByRole("button", { name: "Approve for this channel" }).click(); await page.getByRole("alert").waitFor();
          check(JSON.stringify(requests.filter(req => req.method === "POST").map(req => req.body)) === JSON.stringify([{ action: "approve-candidate", candidateFingerprint: hash }]), `${name}: approval sends only the exact candidate fingerprint`);
          check((await page.getByRole("alert").innerText()).includes("Fixture evidence no longer qualifies"), `${name}: failed approval must not claim success`);
          await layoutCheck(page, `${name}-decisions`);
          await page.getByRole("button", { name: "Approve for this channel" }).click();
          await page.getByText(/^Candidate approved for its source channel/).waitFor();
          check(await page.getByRole("button", { name: "Approve for this channel" }).count() === 0, `${name}: successful approval refreshes the real inventory view`);
          check(/Awaiting review\s*0/.test(await summary.innerText()), `${name}: approved candidate no longer counted as pending`);
          refreshError = true; await page.getByRole("button", { name: /Refresh registry/ }).click();
          await page.getByText("Fixture registry unavailable", { exact: true }).waitFor();
          check(await summary.count() === 0, `${name}: failed refresh must not leave stale counts looking current`);
          check(await page.getByRole("button", { name: "Approve for this channel" }).count() === 0, `${name}: failed refresh must not leave stale approvals actionable`);
          refreshError = false; await page.getByRole("button", { name: /Refresh registry/ }).click(); await summary.waitFor();
          check(await page.getByRole("alert").count() === 0, `${name}: retry clears load failure after a successful response`);
          const rules = page.locator("details"); await rules.locator("summary").focus(); await page.keyboard.press("Enter");
          check(await rules.getAttribute("open") !== null, `${name}: reuse rules expand with keyboard`);
          await layoutCheck(page, `${name}-rules`);
        }
        await layoutCheck(page, `${name}-${state}`);
        if (state === "loading" || state === "checking") {
          const cancelled = page.waitForEvent("requestfailed", { predicate: request => request.url().includes(state === "loading" ? "/api/studio-assets" : "/api/operations/elevation"), timeout: 5000 });
          await page.evaluate(() => (window as unknown as { unmountFixture: () => void }).unmountFixture());
          await cancelled;
        }
      } finally {
        for (const route of pending) await route.abort().catch(() => {});
        await page.unrouteAll({ behavior: "ignoreErrors" }); await context.close();
      }
    }
  }
  await writeFile(join(outputDir,"results.json"), JSON.stringify({ results, failures, errors, external }, null, 2));
  console.log(JSON.stringify({ outputDir, failures, errors, external }, null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(failures, []);
} finally { await browser.close(); await new Promise<void>(done => server.close(() => done())); }
