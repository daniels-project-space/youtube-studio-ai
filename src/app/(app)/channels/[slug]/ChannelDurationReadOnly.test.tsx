import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { ChannelDurationReadOnly } from "./ChannelDurationReadOnly";

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
    await page.route("**/*", route => route.abort());
    const view = async (effective: Parameters<typeof ChannelDurationReadOnly>[0]["effective"]) => {
      await page.setContent(renderToStaticMarkup(<ChannelDurationReadOnly effective={effective} />));
      assert.equal(await page.locator("input, select, button, textarea, form").count(), 0);
      assert.match(await page.locator("body").innerText(), /Read only/);
    };
    await view({ durationSource: "assembly", targetSeconds: 7200, minimumSeconds: 0, maximumSeconds: 7300 });
    assert.match(await page.locator("body").innerText(), /Assembly duration: 2 hr \(7200 sec\)/);
    assert.match(await page.locator("body").innerText(), /Saved length range: 0 sec to 7300 sec/);
    await view({ durationSource: "script_maximum", targetSeconds: 1200, minimumSeconds: null, maximumSeconds: null });
    assert.match(await page.locator("body").innerText(), /Script maximum: 20 min \(1200 sec\)/);
    assert.match(await page.locator("body").innerText(), /Saved length range: Not recorded/);
    await view(null);
    assert.match(await page.locator("body").innerText(), /Saved duration is unavailable/);
    await view(undefined);
    assert.match(await page.locator("body").innerText(), /Loading saved duration/);
    console.log("Duration settings show source, missing and unavailable values without editable controls");
  } finally { await browser.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
