/**
 * Read-only visual inventory for the complete Studio surface.
 *
 * Captures every static app route at desktop/mobile, opens native disclosure
 * panels, records overflow and control geometry, and follows one real channel
 * and run detail link when the public viewer can see them. It never clicks a
 * mutation, spend, publish, OAuth-start, or destructive control.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.UI_AUDIT_BASE_URL ?? "https://youtube-studio-ai.vercel.app";
const outputDir = process.env.UI_AUDIT_OUTPUT_DIR ?? "/tmp/ysa-ui-audit/pass5";
const executablePath = process.env.UI_AUDIT_CHROMIUM ?? "/snap/bin/chromium";

const defaultRoutes = [
  "/",
  "/channels",
  "/channels/new",
  "/runs",
  "/schedule",
  "/library",
  "/analytics",
  "/seo",
  "/editorial-evidence",
  "/studio-assets",
  "/golden",
  "/casefile",
  "/novita-render",
  "/lofi",
  "/loreshort",
  "/settings",
  "/operator-login",
];
const staticRoutes = process.env.UI_AUDIT_ROUTES
  ? process.env.UI_AUDIT_ROUTES.split(",").map((route) => route.trim()).filter(Boolean)
  : defaultRoutes;
const CHANNEL_DETAIL_TABS = [
  "week-ahead",
  "library",
  "analytics",
  "seo",
  "identity",
  "pipeline",
  "settings",
];
const viewports = [
  { id: "desktop", width: 1440, height: 1000 },
  { id: "mobile", width: 390, height: 844 },
];

function routeId(route) {
  return route === "/"
    ? "studio"
    : route.slice(1).replace(/[/?=&]+/gu, "--").replace(/-+$/gu, "");
}

async function pageInventory(page) {
  return await page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
    };
    const text = (element) => (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
    const controls = Array.from(document.querySelectorAll("button, a, input, select, textarea, summary"))
      .filter(visible)
      .map((element) => {
        const effectiveTarget = element.matches('input[type="checkbox"], input[type="radio"]')
          ? element.closest("label") ?? element
          : element;
        const box = effectiveTarget.getBoundingClientRect();
        const studioControl = Boolean(element.closest(".studio-shell"));
        const touchTarget = studioControl && (
          element.matches("button, input, select, textarea, summary")
          || element.matches("a[class]")
        );
        return {
          tag: element.tagName.toLowerCase(),
          label: text(effectiveTarget) || element.getAttribute("aria-label") || element.getAttribute("placeholder") || "",
          width: Math.round(box.width),
          height: Math.round(box.height),
          effectiveTarget: effectiveTarget === element ? element.tagName.toLowerCase() : effectiveTarget.tagName.toLowerCase(),
          disabled: "disabled" in element ? Boolean(element.disabled) : false,
          studioControl,
          touchTarget,
        };
      });
    return {
      title: document.title,
      h1: Array.from(document.querySelectorAll("h1")).filter(visible).map(text),
      h2: Array.from(document.querySelectorAll("h2")).filter(visible).map(text),
      disclosures: Array.from(document.querySelectorAll("details")).map((element) => ({
        open: element.open,
        label: text(element.querySelector("summary") ?? element),
      })),
      regions: {
        sections: Array.from(document.querySelectorAll("section")).filter(visible).length,
        articles: Array.from(document.querySelectorAll("article")).filter(visible).length,
        dialogs: Array.from(document.querySelectorAll('[role="dialog"], dialog')).filter(visible).length,
      },
      iframes: Array.from(document.querySelectorAll("iframe")).filter(visible).map((element) => {
        const box = element.getBoundingClientRect();
        return {
          title: element.title,
          src: element.src,
          id: element.id,
          className: element.className,
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
          html: element.outerHTML.slice(0, 800),
        };
      }),
      fixedElements: Array.from(document.querySelectorAll("body *")).filter((element) =>
        visible(element) && getComputedStyle(element).position === "fixed",
      ).map((element) => {
        const box = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: typeof element.className === "string" ? element.className : "",
          label: text(element),
          zIndex: getComputedStyle(element).zIndex,
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
          html: element.outerHTML.slice(0, 800),
        };
      }).slice(0, 40),
      controls,
      overflow: {
        viewportWidth: window.innerWidth,
        bodyScrollWidth: body.scrollWidth,
        rootScrollWidth: html.scrollWidth,
        horizontal: Math.max(body.scrollWidth, html.scrollWidth) > window.innerWidth + 2,
      },
    };
  });
}

async function captureRoute(browser, viewport, route, discovered, records) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
  });
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 500)));
  const id = routeId(route);
  try {
    const response = await page.goto(new URL(route, baseUrl).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(1_600);
    const inventory = await pageInventory(page);
    await page.screenshot({ path: `${outputDir}/${id}--${viewport.id}.png`, fullPage: true });

    const disclosureCount = await page.locator("details").count();
    if (disclosureCount > 0) {
      await page.locator("details").evaluateAll((elements) => {
        for (const element of elements) element.open = true;
      });
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${outputDir}/${id}--${viewport.id}--panels.png`, fullPage: true });
    }

    if (viewport.id === "mobile" && route === "/") {
      const more = page.locator(".studio-nav-more-trigger");
      if (await more.count()) {
        await more.click();
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${outputDir}/studio--mobile--navigation.png`, fullPage: false });
      }
    }

    if (route === "/channels") {
      const hrefs = await page.locator('a[href^="/channels/"]').evaluateAll((links) =>
        links.map((link) => link.getAttribute("href")).filter(Boolean),
      );
      const detail = hrefs.find((href) => href !== "/channels/new");
      if (detail) discovered.channels.add(detail);
    }
    if (route === "/runs") {
      const hrefs = await page.locator('a[href^="/runs/"]').evaluateAll((links) =>
        links.map((link) => link.getAttribute("href")).filter(Boolean),
      );
      if (hrefs[0]) discovered.runs.add(hrefs[0]);
    }

    records.push({
      route,
      viewport: viewport.id,
      status: response?.status(),
      finalUrl: page.url(),
      inventory,
      consoleErrors,
      pageErrors,
    });
  } catch (error) {
    records.push({
      route,
      viewport: viewport.id,
      finalUrl: page.url(),
      error: error instanceof Error ? error.message : String(error),
      consoleErrors,
      pageErrors,
    });
  } finally {
    await context.close();
  }
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const records = [];
const discovered = { channels: new Set(), runs: new Set() };
let dynamicRoutes = [];
try {
  for (const viewport of viewports) {
    for (const route of staticRoutes) {
      await captureRoute(browser, viewport, route, discovered, records);
    }
  }
  const channelRoute = Array.from(discovered.channels)[0];
  dynamicRoutes = [
    ...(channelRoute
      ? [channelRoute, ...CHANNEL_DETAIL_TABS.map((tab) => `${channelRoute}?tab=${tab}`)]
      : []),
    ...Array.from(discovered.runs).slice(0, 1),
  ];
  for (const viewport of viewports) {
    for (const route of dynamicRoutes) {
      await captureRoute(browser, viewport, route, discovered, records);
    }
  }
} finally {
  await browser.close();
}

const auditedRecords = records.map((record) => {
  const smallTouchTargets = record.viewport === "mobile"
    ? record.inventory?.controls?.filter((control) =>
        control.touchTarget
        && !control.disabled
        && (control.width < 44 || control.height < 44),
      ) ?? []
    : [];
  return { ...record, smallTouchTargets };
});
const report = {
  contract: "studio-ui-seventh-pass-audit/v2",
  baseUrl,
  capturedAt: new Date().toISOString(),
  routes: auditedRecords,
};
await writeFile(`${outputDir}/report.json`, JSON.stringify(report, null, 2), "utf8");
const failures = auditedRecords.filter((record) =>
  record.error
    || (record.status != null && record.status >= 400)
    || record.inventory?.overflow?.horizontal
    || record.pageErrors?.length
    || record.consoleErrors?.length
    || record.smallTouchTargets.length,
);
console.log(`Captured ${records.length} route/viewport states in ${outputDir}`);
console.log(`Dynamic routes: ${dynamicRoutes.join(", ") || "none visible"}`);
console.log(`Audit failures: ${failures.length}`);
if (failures.length) {
  for (const failure of failures) {
    const reasons = [
      failure.error,
      failure.status != null && failure.status >= 400 ? `HTTP ${failure.status}` : null,
      failure.inventory?.overflow?.horizontal ? "horizontal overflow" : null,
      ...(failure.pageErrors ?? []),
      ...(failure.consoleErrors ?? []),
      ...(failure.smallTouchTargets ?? []).map((control) =>
        `${control.tag} ${control.width}x${control.height} ${control.label}`,
      ),
    ].filter(Boolean);
    console.log(`${failure.viewport} ${failure.route}: ${reasons.join("; ")}`);
  }
  process.exitCode = 1;
}
