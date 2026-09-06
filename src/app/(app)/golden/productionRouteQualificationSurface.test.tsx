/**
 * Static-render contract for the route-qualification surface.
 *
 * Rendered through renderAppPage for the same reason as its sibling: without
 * the layout's Convex client, OwnerLockBadge's useQuery throws and none of the
 * assertions below run.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { renderAppPage, stubCssImports } from "@/lib/testSupport/renderAppPage";

async function main(): Promise<void> {
  stubCssImports(createRequire(import.meta.url));
  const { default: GoldenPipelinePage } = await import("./page");
  const html = await renderAppPage(GoldenPipelinePage);

  assert.match(html, /Route qualification/);
  assert.match(html, /NO RECEIPT CONNECTED/);
  assert.match(html, /No persisted per-channel qualification receipt is connected to the Golden catalog/i);
  assert.match(html, /Family admission is policy-level information/i);
}

main().then(() => console.log("golden production route qualification surface tests passed"));
