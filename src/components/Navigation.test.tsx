import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Actual components and links; only the Next router is supplied by this SSR harness.
// Responsive visibility, keyboard interaction and real data are checked by the browser proof.
const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
const originalLoad = loader._load;
const require = createRequire(import.meta.url);
let pathname = "/channels";
loader._load = function (...args: unknown[]) {
  if (args[0] === "next/navigation") return { usePathname: () => pathname };
  return originalLoad.apply(this, args);
};

try {
  const { Sidebar } = require("./Sidebar") as typeof import("./Sidebar");
  const { NavItem } = require("./NavItem") as typeof import("./NavItem");
  const html = renderToStaticMarkup(createElement(Sidebar));
  for (const href of ["/", "/channels", "/runs", "/schedule", "/library", "/analytics", "/golden", "/settings"]) {
    assert.match(html, new RegExp(`href="${href}"`), `${href} remains a real route`);
  }
  assert.match(html, /aria-label="Studio navigation"/);
  assert.match(html, /aria-expanded="false" aria-controls="studio-mobile-more-menu"/);
  assert.doesNotMatch(html, /id="studio-mobile-more-menu"/, "closed overflow menu is not mounted");
  for (const href of ["/novita-render", "/lofi", "/loreshort", "/seo", "/casefile"]) {
    assert.ok(!html.includes(`href="${href}"`), "specialist links remain inside their modules");
  }

  pathname = "/runs/actual-run";
  const compact = renderToStaticMarkup(createElement(NavItem, {
    href: "/runs", label: "Production", icon: null, compactOnly: true,
  }));
  assert.match(compact, /href="\/runs"/);
  assert.match(compact, /aria-current="page"/);
  assert.match(compact, /data-compact-only="true"/);
  const activeSidebar = renderToStaticMarkup(createElement(Sidebar));
  assert.match(activeSidebar, /data-compact-active="true"/,
    "More can indicate the selected route when Production moves into its compact menu");
  const regular = renderToStaticMarkup(createElement(NavItem, { href: "/", label: "Studio", icon: null }));
  assert.doesNotMatch(regular, /data-compact-only|aria-current=/,
    "a nonselected regular link is neither compact-only nor falsely current");
} finally { loader._load = originalLoad; }

// Scrolled content may not lower the contrast of shared navigation. The live
// proof independently compares rendered pixels over actual page content.
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const topbar = css.match(/\.studio-topbar\s*\{([^}]+)\}/)?.[1];
assert.ok(topbar, "shared navigation surface exists");
assert.match(topbar, /background:[\s\S]*var\(--color-canvas\);/,
  "tinted navigation has an opaque canvas base, not translucent page content");
assert.match(css, /--color-canvas:\s*#[0-9a-f]{6};/i, "the navigation base token stays opaque");
assert.doesNotMatch(topbar, /backdrop-filter:/, "an opaque bar does not need a backdrop-filter layer");

console.log("Actual navigation route, compact-state and specialist-boundary contracts passed");
