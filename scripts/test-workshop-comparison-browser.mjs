import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, scryptSync } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import net from "node:net";
import os from "node:os";
import { copyFile, cp, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { SignJWT } from "jose";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = "/root/.cache/convex/binaries/precompiled-2026-10-22-1447815/convex-local-backend";
const temp = await mkdtemp(path.join(os.tmpdir(), "youtube-workshop-comparison-"));
const secrets = [];
let backend, web, browser, jwks;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 180_000, ...options });
  if (result.error || result.status !== 0) {
    let detail = (result.stderr ?? "").slice(-2000);
    for (const secret of secrets) detail = detail.replaceAll(secret, "[redacted]");
    throw new Error(`${path.basename(command)} failed: ${result.error?.message ?? result.status}\n${detail}`);
  }
  return result.stdout.trim();
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const canonical = value => JSON.stringify(value, function(_key, item) {
  return item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});

try {
  assert.equal(createHash("sha256").update(await readFile(binary)).digest("hex"), "044eedfe569b1550d5003683aec7fceb4dcee3f82abf00ab9baf1c10d3ca0b4c");
  const project = path.join(temp, "project"), data = path.join(temp, "data");
  await mkdir(data, { recursive: true });
  for (const directory of ["src", "public"]) await cp(path.join(root, directory), path.join(project, directory), { recursive: true });
  for (const file of ["package.json", "tsconfig.json", "tsconfig.website.json", "postcss.config.mjs", "next.config.ts", "convex/auth.config.ts", "convex/studioFunctions.ts", "convex/workshopDesignImports.ts", "convex/_generated/server.js", "convex/_generated/server.d.ts", "convex/_generated/dataModel.d.ts", "convex/_generated/api.js", "convex/_generated/api.d.ts"]) {
    const target = path.join(project, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, file), target);
  }
  const nextConfigPath = path.join(project, "next.config.ts");
  const nextConfig = await readFile(nextConfigPath, "utf8");
  assert.ok(nextConfig.includes("const nextConfig: NextConfig = {"));
  await writeFile(nextConfigPath, nextConfig.replace("const nextConfig: NextConfig = {", 'const nextConfig: NextConfig = { serverExternalPackages: ["@trigger.dev/sdk", "@trigger.dev/core"],'));
  await symlink(path.join(root, "node_modules"), path.join(project, "node_modules"), "dir");
  await writeFile(path.join(project, "convex/schema.ts"), 'import { defineSchema, defineTable } from "convex/server"; import { v } from "convex/values"; export default defineSchema({ channels: defineTable(v.any()).index("by_owner", ["ownerId"]).index("by_owner_slug", ["ownerId","slug"]), retainedPipelineCandidates: defineTable(v.any()).index("by_channel_created", ["channelId","createdAt"]), importedWorkshopDesigns: defineTable({ownerId:v.string(),fingerprint:v.string(),design:v.any(),importedAt:v.number()}).index("by_owner_imported", ["ownerId","importedAt"]).index("by_owner_fingerprint", ["ownerId","fingerprint"]) });');
  await writeFile(path.join(project, "convex/channels.ts"), 'import { v } from "convex/values"; import { query } from "./studioFunctions"; export const getChannel = query({ args: {channelId:v.id("channels")}, handler: async (ctx,args) => ctx.db.get(args.channelId) });');
  await writeFile(path.join(project, "convex/retainedPipelineCandidates.ts"), 'import { v } from "convex/values"; import { query } from "./studioFunctions"; export const list = query({ args: {ownerId:v.string(),channelId:v.id("channels")}, handler: async (ctx,args) => ctx.db.query("retainedPipelineCandidates").withIndex("by_channel_created",q => q.eq("channelId",args.channelId)).order("desc").take(100) });');
  await writeFile(path.join(project, "convex/fixture.ts"), 'import { mutation, query } from "./_generated/server"; import { v } from "convex/values"; export const seed = mutation({args:{},handler:async ctx => { const a = await ctx.db.insert("channels",{ownerId:"test-owner-a",name:"Alpha",slug:"alpha",family:"narrated_stock",pipeline:[{block:"quote_overlays",params:{maxQuotes:2}},{block:"script_gen"}],moduleConfig:{quote_overlays:{maxQuotes:5}}}); const duplicate = await ctx.db.insert("channels",{ownerId:"test-owner-a",name:"Repeated",slug:"repeated",family:"narrated_stock",pipeline:[{block:"quote_overlays",version:"1",params:{maxQuotes:2}},{block:"script_gen"},{block:"quote_overlays",version:"2",params:{maxQuotes:3}}],moduleConfig:{quote_overlays:{maxQuotes:5}}}); for(let i=0;i<99;i++) await ctx.db.insert("channels",{ownerId:"test-owner-a",name:`Filler ${i}`,slug:`filler-${i}`,pipeline:[]}); const late = await ctx.db.insert("channels",{ownerId:"test-owner-a",name:"Older channel",slug:"older-channel",family:"narrated_stock",pipeline:[{block:"script_gen",params:{tone:"measured"}}]}); const b = await ctx.db.insert("channels",{ownerId:"test-owner-b",name:"Other",slug:"other",pipeline:[]}); return {a,b,duplicate,late}; }}); export const all = query({args:{},handler:async ctx => ctx.db.query("channels").collect()});');
  await writeFile(path.join(project, "src/app/layout.tsx"), 'export default function Layout({children}: {children: React.ReactNode}) { return <html><body>{children}</body></html>; }');
  await writeFile(path.join(project, "convex/evidenceFixture.ts"), 'import { mutation } from "./_generated/server"; import { v } from "convex/values"; export const add = mutation({args:{channelId:v.id("channels"),candidate:v.any(),fingerprint:v.string()},handler:async (ctx,args) => ctx.db.insert("retainedPipelineCandidates",{ownerId:"test-owner-a",channelId:args.channelId,candidate:args.candidate,fingerprint:args.fingerprint,createdAt:1})}); export const setConfig = mutation({args:{channelId:v.id("channels"),moduleConfig:v.any()},handler:async (ctx,args) => ctx.db.patch(args.channelId,{moduleConfig:args.moduleConfig})});');
  const pageDir = path.join(project, "src/app/handoff-test");
  await mkdir(pageDir, { recursive: true });
  await writeFile(path.join(pageDir, "page.tsx"), '"use client"; import { ConvexClientProvider } from "@/app/ConvexClientProvider"; import { OperationsAccessProvider } from "@/components/OperationsAccess"; import { OwnerProvider } from "@/lib/owner-context"; import { WorkshopDesignImports } from "@/components/WorkshopDesignImports"; export default function Page() { return <ConvexClientProvider><OwnerProvider ownerId="test-owner-a"><OperationsAccessProvider><WorkshopDesignImports /></OperationsAccessProvider></OwnerProvider></ConvexClientProvider>; }');
  const loader = path.join(temp, "secret-launch.so");
  run("cc", ["-shared", "-fPIC", "-O2", "-o", loader, path.join(root, "scripts/convex-secret-launch.c"), "-ldl"]);
  const secret = randomBytes(32).toString("hex"), instance = `comparison-${randomBytes(8).toString("hex")}`;
  secrets.push(secret);
  const launchEnv = { PATH: process.env.PATH, YTA_CONVEX_INSTANCE_SECRET: secret, LD_PRELOAD: loader };
  const admin = run(binary, ["keygen", "admin-key", "--instance-name", instance], { env: launchEnv });
  secrets.push(admin);
  const port = await freePort();
  let sitePort = await freePort();
  while (sitePort === port) sitePort = await freePort();
  const url = `http://127.0.0.1:${port}`;
  backend = spawn(binary, ["--interface", "127.0.0.1", "--port", String(port), "--site-proxy-port", String(sitePort), "--instance-name", instance, "--disable-beacon"], { cwd: data, env: launchEnv, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    if (backend.exitCode !== null) throw new Error("Disposable backend exited");
    try { if ((await fetch(`${url}/version`, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* starting */ }
    if (i === 99) throw new Error("Disposable backend unavailable");
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  for (const owned of [port, sitePort]) assert.match(run("ss", ["-lptn", `sport = :${owned}`]), new RegExp(`pid=${backend.pid}(?:,|\\))`));
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const rawJwk = publicKey.export({ format: "jwk" });
  const kid = createHash("sha256").update(JSON.stringify({ crv: rawJwk.crv, kty: rawJwk.kty, x: rawJwk.x, y: rawJwk.y })).digest("base64url");
  jwks = createServer((_req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ keys: [{ ...rawJwk, alg: "ES256", use: "sig", kid }] })); });
  await new Promise(resolve => jwks.listen(0, "127.0.0.1", resolve));
  const issuer = `http://127.0.0.1:${jwks.address().port}`, audience = "comparison-test";
  const cliEnv = { PATH: process.env.PATH, CONVEX_SELF_HOSTED_URL: url, CONVEX_SELF_HOSTED_ADMIN_KEY: admin, CI: "1", DISABLE_TELEMETRY: "1" };
  const cli = (...args) => run(path.join(root, "node_modules/.bin/convex"), args, { cwd: project, env: cliEnv });
  cli("env", "set", "STUDIO_CONVEX_ISSUER", issuer);
  cli("env", "set", "STUDIO_CONVEX_JWKS_URL", `${issuer}/jwks`);
  cli("env", "set", "STUDIO_CONVEX_AUDIENCE", audience);
  cli("dev", "--once", "--typecheck", "disable", "--codegen", "disable", "--tail-logs", "disable");
  const token = await new SignJWT({ role: "owner", owner_id: "test-owner-a" }).setProtectedHeader({ alg: "ES256", kid }).setIssuer(issuer).setAudience(audience).setSubject("test-owner-a").setIssuedAt().setExpirationTime("10m").sign(privateKey);
  const client = new ConvexHttpClient(url); client.setAuth(token);
  const ids = await client.mutation(anyApi.fixture.seed, {});
  const evidenceCandidate = { ownerId: "test-owner-a", channelId: ids.a, sourceRunId: "synthetic-benchmark", entries: [{ block: "script_gen", version: "1", params: { tone: "measured" } }], workerDeployment: { version: "synthetic-worker" } };
  await client.mutation(anyApi.evidenceFixture.add, { channelId: ids.a, candidate: evidenceCandidate, fingerprint: createHash("sha256").update(canonical(evidenceCandidate)).digest("hex") });
  const before = await client.query(anyApi.fixture.all, {});
  const content = { version: "workshop-design-snapshot/v2", name: "Imported design", family: "narrated_stock", entries: [{ block: "script_gen" }, { block: "quote_overlays", params: { maxQuotes: 3 } }, { block: "narration_tts" }], channelDesign: { revision: 1, name: "Concept", niche: "History", persona: "Curious", palette: ["#123456"] } };
  const fixtureBytes = process.env.WORKSHOP_CROSS_APP_FIXTURE ? await readFile(process.env.WORKSHOP_CROSS_APP_FIXTURE) : undefined;
  const design = fixtureBytes ? JSON.parse(fixtureBytes.toString()) : { ...content, fingerprint: createHash("sha256").update(canonical(content)).digest("hex") };
  assert.equal(design.name, "Imported design");
  const webPort = await freePort(), origin = `http://127.0.0.1:${webPort}`;
  const password = randomBytes(18).toString("hex"), salt = randomBytes(16).toString("hex"), sessionSecret = randomBytes(32).toString("hex");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  secrets.push(password, sessionSecret, privatePem);
  const webEnv = { PATH: process.env.PATH, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", YOUTUBE_AUTOMATION_PRIVATE: "1", YTA_LOCAL_WEB_ORIGIN: origin, YOUTUBE_AUTOMATION_PASSWORD_SCRYPT: `scrypt$${salt}$${scryptSync(password, Buffer.from(salt, "hex"), 32).toString("hex")}`, STUDIO_SESSION_SECRET: sessionSecret, STUDIO_OWNER_ID: "test-owner-a", STUDIO_CONVEX_JWT_PRIVATE_KEY: privatePem, STUDIO_CONVEX_ISSUER: issuer, STUDIO_CONVEX_JWKS_URL: `${issuer}/jwks`, STUDIO_CONVEX_AUDIENCE: audience, NEXT_PUBLIC_CONVEX_URL: url };
  let log = "";
  web = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(webPort)], { cwd: project, env: webEnv, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [web.stdout, web.stderr]) stream.on("data", chunk => { log = (log + chunk.toString()).slice(0, 6000); });
  for (let i = 0; i < 300; i++) {
    if (web.exitCode !== null) throw new Error(`Preview exited: ${log}`);
    try { if ((await fetch(`${origin}/operator-login`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* starting */ }
    if (i === 299) throw new Error(`Preview unavailable: ${log}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const listener = /pid=(\d+)/.exec(run("ss", ["-lptn", `sport = :${webPort}`]));
  assert.ok(listener); assert.equal(await readlink(`/proc/${listener[1]}/cwd`), project);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const context = await browser.newContext();
  await context.route("**/*", route => [origin, url].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  await page.goto(`${origin}/operator-login`);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.goto(`${origin}/handoff-test`);
  await page.getByRole("button", { name: "View snapshots" }).click();
  const upload = page.getByLabel("Import JSON snapshot");
  await upload.setInputFiles({ name: "tampered.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...design, name: "Tampered" })) });
  await page.getByText(/Import failed:.*fingerprint/i).waitFor();
  assert.equal((await client.query(anyApi.workshopDesignImports.list, { ownerId: "test-owner-a" })).length, 0);
  await upload.setInputFiles({ name: "design.json", mimeType: "application/json", buffer: fixtureBytes ?? Buffer.from(JSON.stringify(design)) });
  await page.getByText("Snapshot imported as untrusted.").waitFor();
  await upload.setInputFiles({ name: "design.json", mimeType: "application/json", buffer: fixtureBytes ?? Buffer.from(JSON.stringify(design)) });
  await page.getByText("This snapshot was already imported.").waitFor();
  const importedRecords = await client.query(anyApi.workshopDesignImports.list, { ownerId: "test-owner-a" });
  assert.equal(importedRecords.length, 1);
  assert.deepEqual(importedRecords[0].design, design);
  if (fixtureBytes) assert.deepEqual(await readFile(process.env.WORKSHOP_CROSS_APP_FIXTURE), fixtureBytes);
  const review = page.locator("details").filter({ hasText: "Imported design" });
  await review.locator("summary").click();
  const select = review.getByLabel("Existing channel");
  assert.equal(await select.locator("option").count(), 101);
  assert.equal(await select.locator(`option[value="${ids.late}"]`).count(), 0);
  assert.deepEqual(await client.query(anyApi.workshopDesignImports.channelBySlug, { ownerId: "test-owner-a", slug: "other" }), { channel: null, ambiguous: false });
  await assert.rejects(client.query(anyApi.workshopDesignImports.channelBySlug, { ownerId: "test-owner-b", slug: "other" }));
  const baselineResponse = page.waitForResponse(response => response.url().includes("/api/workshop-design-comparison?"));
  await select.selectOption(ids.a);
  const baselineRequest = await baselineResponse;
  if (baselineRequest.status() !== 200) throw new Error(`Baseline request returned ${baselineRequest.status()}\n${log}`);
  await review.getByText(/Saved channel format: narrated_stock/).waitFor();
  await review.getByText(/quote_overlays:.*Relative order changed.*Settings changed/).waitFor();
  await review.getByText(/script_gen:.*Relative order changed/).waitFor();
  await review.getByText(/narration_tts: Added/).waitFor();
  await review.getByText("Saved baseline modules").click();
  await review.getByText(/"maxQuotes": 5/).waitFor();
  await review.getByText(/do not establish qualification/).waitFor();
  await review.getByText(/Versions not specified/).waitFor();
  await review.getByRole("button", { name: "Recheck displayed baseline" }).click();
  await review.getByText(/matched the saved baseline at/).waitFor();
  await client.mutation(anyApi.evidenceFixture.setConfig, { channelId: ids.a, moduleConfig: { quote_overlays: { maxQuotes: 7 } } });
  await review.getByRole("button", { name: "Recheck displayed baseline" }).click();
  await review.getByText(/saved format or pipeline settings changed/).waitFor();
  await client.mutation(anyApi.evidenceFixture.setConfig, { channelId: ids.a, moduleConfig: { quote_overlays: { maxQuotes: 5 } } });
  const evidencePanel = review.getByRole("region", { name: "Compare retained benchmark evidence" });
  await evidencePanel.getByRole("button", { name: "Check retained evidence" }).click();
  await evidencePanel.getByText(/synthetic-benchmark/).waitFor();
  await evidencePanel.getByText(/does not prove this design produced a benchmark/).waitFor();
  await evidencePanel.getByText(/script_gen:.*Version omitted.*Settings changed/).waitFor();
  await select.selectOption(ids.duplicate);
  await review.getByText(/Repeated modules require manual comparison: quote_overlays/).waitFor();
  await review.getByText(/saved baseline applies block-keyed settings/).waitFor();
  assert.equal(await review.getByText(/quote_overlays:.*Settings changed/).count(), 0);
  await review.getByRole("button", { name: "Refresh baseline" }).click();
  await review.getByText(/Repeated modules require manual comparison: quote_overlays/).waitFor();
  await review.getByLabel("Exact channel slug").fill("older-channel");
  await review.getByRole("button", { name: "Find channel" }).click();
  await review.getByRole("button", { name: "Compare Older channel" }).click();
  await review.getByText(/Saved channel format: narrated_stock/).waitFor();
  await review.getByText(/script_gen:.*Settings changed/).waitFor();
  if (await review.locator("details").filter({ hasText: "Saved baseline modules" }).getAttribute("open") === null) await review.getByText("Saved baseline modules").click();
  await review.getByText(/"tone": "measured"/).waitFor();
  const foreign = await page.request.get(`${origin}/api/workshop-design-comparison?channelId=${ids.b}`);
  assert.equal(foreign.status(), 503);
  assert.deepEqual(await foreign.json(), { error: "Channel baseline is unavailable." });
  assert.deepEqual(await client.query(anyApi.fixture.all, {}), before);
  await page.reload();
  await page.getByRole("button", { name: "View snapshots" }).click();
  await review.locator("summary").click();
  await select.selectOption(ids.a);
  await review.getByText(/quote_overlays:.*Settings changed/).waitFor();
  assert.deepEqual(await client.query(anyApi.fixture.all, {}), before);
  console.log("PASS: authenticated import review compares saved overrides, order and additions; rejects foreign channel; channels unchanged after reload");
} finally {
  if (browser) await browser.close();
  for (const child of [web, backend]) if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise(resolve => { child.once("exit", resolve); setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000).unref(); });
  }
  if (jwks) await new Promise(resolve => jwks.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
