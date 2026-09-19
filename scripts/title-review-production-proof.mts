/** Read-only production regression: no auth fixtures, interception or mutations. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const expectedSha = process.argv[2];
const previewPageTrack = process.argv.includes("--preview-page-track");
assert.match(expectedSha ?? "", /^[a-f0-9]{40}$/);
const base = "https://youtube-studio-ai.vercel.app";
const url = base + "/runs/js705md1etr1kr0mpbpvpqaz8x89znvt";
const health = await fetch(base + "/api/health", { cache: "no-store" });
assert.equal(health.status, 200); assert.equal((await health.json()).revision, expectedSha);
const outputDir = await mkdtemp(join(tmpdir(), "ysa-title-review-production-"));
const browser = await chromium.launch({ executablePath: process.env.UI_AUDIT_CHROMIUM ?? "/snap/bin/chromium", args: ["--no-sandbox"] });
const results = [];
try {
  for (const [label, width, fontSize] of [["desktop", 1440, 16], ["mobile", 390, 16], ["large-text", 390, 32]] as const) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage(), errors: string[] = [], queries: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.type === "ModifyQuerySet") for (const modification of message.modifications ?? []) {
          if (modification.type === "Add" && typeof modification.udfPath === "string") queries.push(modification.udfPath);
        }
      } catch { /* Ignore non-JSON protocol frames; never print auth messages. */ }
    }));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const phase = page.locator("button[aria-pressed]").filter({ hasText: "Metadata" });
    await phase.waitFor({ timeout: 60000 });
    if (previewPageTrack) await page.addStyleTag({ content: "div:has(> #pipeline-route) { grid-template-columns: minmax(0, 1fr); }" });
    await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
    await phase.click();
    await page.getByRole("button", { name: /Metadata/ }).last().click();
    const shelf = page.getByRole("region", { name: "Metadata stage receipts" });
    await shelf.locator("pre").waitFor();
    const text = await shelf.innerText();
    assert.ok(text.includes("Taxation Isn't Complex"), "the real retained stage output must still be inspectable");
    assert.equal(await shelf.getByText("Inputs", { exact: true }).count(), 0, "slim responses should not reserve an empty Inputs column");
    assert.equal(await shelf.getByRole("region", { name: "Saved title review" }).count(), 0,
      "this legacy run has no decision receipt; do not invent one");
    await shelf.screenshot({ path: join(outputDir, `${label}-metadata.png`) });
    await page.screenshot({ path: join(outputDir, `${label}-page.png`), fullPage: true });
    const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    const inspectorGeometry = await shelf.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, right: bounds.right,
        children: [...element.querySelectorAll("[data-status], pre, button")].map((child) => ({
          tag: child.tagName, width: child.getBoundingClientRect().width, right: child.getBoundingClientRect().right,
        })) };
    });
    console.log(JSON.stringify({ label, inspectorGeometry }));
    assert.ok(inspectorGeometry.right <= width && inspectorGeometry.children.every((child) => child.right <= width),
      label + ": inspector clipped outside viewport despite a non-scrolling document");
    assert.equal(geometry.document, geometry.viewport, label + ": horizontal overflow");
    assert.deepEqual(errors, []);
    assert.equal(queries.filter((q) => q === "videos:getRunMediaPresentation").length, 1);
    assert.equal(queries.filter((q) => ["assets:listForRun", "videos:getVideoDetail"].includes(q)).length, 0);
    results.push({ label, ...geometry, inspectorGeometry, errors, mediaSubscriptions: queries.filter((q) => q.startsWith("videos:")) });
    await context.close();
  }
  await writeFile(join(outputDir, "results.json"), JSON.stringify({ expectedSha, url, previewPageTrack, results }, null, 2));
  console.log(JSON.stringify({ outputDir, expectedSha, url, previewPageTrack, results }, null, 2));
} finally { await browser.close(); }
