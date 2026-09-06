/**
 * Static-render a studio page the way the app layout would.
 *
 * A page test that imports a page module directly renders it OUTSIDE the app
 * layout, so nothing above it supplies the Convex client that
 * ConvexClientProvider normally does. Any client component in the tree that
 * calls useQuery then throws "Could not find Convex client!" and the entire
 * surface contract below it stops being checked.
 *
 * That is not hypothetical. When the owner lock moved from marker files to
 * Convex (commit ceb2b5a), OwnerLockBadge started calling useQuery, and BOTH
 * golden surface tests began failing on every run — silently, in the sense that
 * the pages themselves were fine in production, because the real layout does
 * provide a client. Two tests broke for one reason, which is the argument for
 * one helper rather than the same five lines pasted into each.
 *
 * The client here is never connected to. Every query resolves to `undefined`,
 * which is precisely the pre-hydration state these components already handle,
 * so what a test asserts is the server-rendered markup — never live data.
 */
import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConvexProvider, ConvexReactClient } from "convex/react";

/** Let a page module import CSS without a bundler. */
export function stubCssImports(require: NodeJS.Require): void {
  require.extensions[".css"] = (module) => {
    const classes = new Proxy({}, { get: (_target, key) => String(key) });
    (module as { exports: unknown }).exports = { __esModule: true, default: classes };
  };
}

/**
 * Render `page` to static markup inside a Convex provider, then close the
 * client so the process can exit.
 */
export async function renderAppPage(
  page: ComponentType<Record<string, never>> | (() => ReactElement),
): Promise<string> {
  const convex = new ConvexReactClient(
    process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://example.convex.cloud",
    // Browser-only feature; constructing it in Node throws without this.
    { unsavedChangesWarning: false },
  );
  try {
    return renderToStaticMarkup(
      createElement(ConvexProvider, { client: convex }, createElement(page as ComponentType)),
    );
  } finally {
    await convex.close();
  }
}
