import {
  normalizeYoutubeChannelName,
  normalizeYoutubeHandle,
} from "@/lib/youtubeChannelCreationClaim";

const SAFE_RECOVERY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// A recovery browser is intentionally narrower than ordinary browsing. These
// provider routes are denied even when they are exposed as GET navigations.
const PROVIDER_MUTATION_URL_FRAGMENTS = [
  "create_channel",
  "create-channel",
  "createchannel",
  "channel/create",
  "channel_creation",
  "channel/rename",
  "channel/edit",
  "channel/delete",
  "edit_channel",
  "rename_channel",
  "delete_channel",
  "/customization",
  "/branding",
] as const;

const PROVIDER_MUTATION_CONTROL_FRAGMENTS = [
  "create channel",
  "create a channel",
  "new channel",
  "rename channel",
  "edit channel",
  "delete channel",
  "kanal erstellen",
  "kanal umbenennen",
  "kanal bearbeiten",
] as const;

export function isYoutubeRecoveryRequestAllowed(method: string, url: string): boolean {
  if (!SAFE_RECOVERY_METHODS.has(method.trim().toUpperCase())) return false;
  const normalizedUrl = url.toLowerCase();
  return !PROVIDER_MUTATION_URL_FRAGMENTS.some((fragment) =>
    normalizedUrl.includes(fragment));
}

export function isYoutubeRecoveryControlDenied(text: string, href = ""): boolean {
  const normalizedText = text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return PROVIDER_MUTATION_CONTROL_FRAGMENTS.some((fragment) =>
    normalizedText.includes(fragment)) ||
    !isYoutubeRecoveryRequestAllowed("GET", href || "about:blank");
}

interface RecoveryRequest {
  method(): string;
  url(): string;
}

interface RecoveryRoute {
  request(): RecoveryRequest;
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
}

interface RecoveryWebSocketRoute {
  close(options?: { code?: number; reason?: string }): Promise<void>;
}

export interface YoutubeRecoveryContext {
  route(
    url: string,
    handler: (route: RecoveryRoute) => Promise<void> | void,
  ): Promise<void>;
  routeWebSocket(
    url: string,
    handler: (route: RecoveryWebSocketRoute) => Promise<void> | void,
  ): Promise<void>;
  addInitScript(script: () => void): Promise<void>;
  newCDPSession(page: YoutubeRecoveryPage): Promise<{
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  }>;
}

export interface YoutubeRecoveryPage {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T>;
}

/**
 * Installs the recovery safety boundary before any provider page is loaded.
 * Recovery allows only read requests, blocks WebSockets and beacons, and
 * suppresses every interactive DOM event. The recovery routine can therefore
 * navigate an exact existing link but cannot submit create/rename/edit UI.
 */
export async function installYoutubeRecoveryGuards(
  context: YoutubeRecoveryContext,
  page: YoutubeRecoveryPage,
): Promise<void> {
  if (
    typeof context.route !== "function" ||
    typeof context.routeWebSocket !== "function" ||
    typeof context.addInitScript !== "function" ||
    typeof context.newCDPSession !== "function"
  ) {
    throw new Error("read-only YouTube recovery guards are unavailable");
  }

  await context.route("**/*", async (route) => {
    const request = route.request();
    if (!isYoutubeRecoveryRequestAllowed(request.method(), request.url())) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket("**/*", async (socket) => {
    await socket.close({ code: 1008, reason: "read-only YouTube recovery" });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  // Playwright routes can otherwise be bypassed by a service worker retained
  // in the authenticated Browserbase context. Force this page through the
  // context request guard before loading any provider origin.
  await cdp.send("Network.setBypassServiceWorker", { bypass: true });
  await context.addInitScript(() => {
    const unsafeUrlFragments = [
      "create_channel",
      "create-channel",
      "createchannel",
      "channel/create",
      "channel_creation",
      "channel/rename",
      "channel/edit",
      "channel/delete",
      "edit_channel",
      "rename_channel",
      "delete_channel",
      "/customization",
      "/branding",
    ];
    const allowed = (method: string, url: string) => {
      const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
      const normalizedUrl = url.toLowerCase();
      return safeMethod && !unsafeUrlFragments.some((fragment) =>
        normalizedUrl.includes(fragment));
    };
    const block = (message: string): never => {
      throw new DOMException(message, "SecurityError");
    };

    // Install interaction suppression first so later API monkey-patches cannot
    // weaken the core control boundary if a provider freezes a prototype.
    for (const eventName of [
      "auxclick",
      "beforeinput",
      "change",
      "click",
      "dblclick",
      "input",
      "keydown",
      "pointerdown",
      "submit",
    ]) {
      window.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }

    try {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : undefined;
        const method = init?.method ?? request?.method ?? "GET";
        const url = request?.url ?? String(input);
        if (!allowed(method, url)) return Promise.reject(
          new DOMException("blocked by read-only YouTube recovery", "SecurityError"),
        );
        return nativeFetch(input, init);
      }) as typeof window.fetch;
    } catch { /* context routing remains the outer request boundary */ }

    try {
      const nativeOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function recoveryOpen(
        method: string,
        url: string | URL,
        async = true,
        username?: string | null,
        password?: string | null,
      ) {
        if (!allowed(method, String(url))) {
          return block("blocked by read-only YouTube recovery");
        }
        Reflect.apply(nativeOpen, this, [method, String(url), async, username, password]);
      };
    } catch { /* context routing remains the outer request boundary */ }

    try {
      Navigator.prototype.sendBeacon = function recoveryBeacon(): boolean {
        return false;
      };
    } catch { /* beacons are also denied by context routing */ }
    try {
      HTMLFormElement.prototype.submit = function recoverySubmit(): never {
        return block("form submission blocked by read-only YouTube recovery");
      };
      HTMLFormElement.prototype.requestSubmit = function recoveryRequestSubmit(): never {
        return block("form submission blocked by read-only YouTube recovery");
      };
    } catch { /* submit events and non-read requests remain blocked */ }
  });
}

export type ExactExistingYoutubeChannelSelection =
  | { selected: true; href: string }
  | { selected: false; reason: string };

export interface YoutubeRecoveryLinkCandidate {
  href: string;
  textLines: string[];
}

export interface YoutubeExactIdentityInventoryAssessment {
  candidateCount: number;
  observedYtChannelIds: string[];
  exactIdentityState: "absent" | "present" | "ambiguous";
}

function exactExistingYoutubeChannelHrefs(
  candidates: YoutubeRecoveryLinkCandidate[],
  args: { name: string; handle: string },
): string[] {
  const expectedName = normalizeYoutubeChannelName(args.name);
  const expectedHandle = `@${normalizeYoutubeHandle(args.handle)}`;
  if (!expectedName || expectedHandle.length < 4) return [];
  const matchingHrefs = candidates.flatMap((candidate) => {
    let url: URL;
    try {
      url = new URL(candidate.href);
    } catch {
      return [];
    }
    const lines = candidate.textLines.map(normalizeYoutubeChannelName).filter(Boolean);
    const sameProvider = /(^|\.)youtube\.com$/i.test(url.hostname);
    const safeHref = isYoutubeRecoveryRequestAllowed("GET", url.href);
    const exactName = lines.includes(expectedName);
    const exactHandle = lines.some((line) => line.toLowerCase() === expectedHandle);
    return sameProvider && safeHref && exactName && exactHandle ? [url.href] : [];
  });
  return [...new Set(matchingHrefs)].sort();
}

export function assessYoutubeExactIdentityInventory(
  candidates: YoutubeRecoveryLinkCandidate[],
  args: { name: string; handle: string },
): YoutubeExactIdentityInventoryAssessment {
  const exactHrefs = exactExistingYoutubeChannelHrefs(candidates, args);
  const observedYtChannelIds = [...new Set(candidates.flatMap((candidate) => {
    try {
      const href = new URL(candidate.href).href;
      const match = decodeURIComponent(href).match(/\/channel\/(UC[A-Za-z0-9_-]{20,})/);
      return match?.[1] ? [match[1]] : [];
    } catch {
      return [];
    }
  }))].sort();
  return {
    candidateCount: candidates.length,
    observedYtChannelIds,
    exactIdentityState: exactHrefs.length === 0
      ? "absent"
      : exactHrefs.length === 1
        ? "present"
        : "ambiguous",
  };
}

export function chooseExactExistingYoutubeChannelLink(
  candidates: YoutubeRecoveryLinkCandidate[],
  args: { name: string; handle: string },
): ExactExistingYoutubeChannelSelection {
  const expectedName = normalizeYoutubeChannelName(args.name);
  const expectedHandle = normalizeYoutubeHandle(args.handle);
  if (!expectedName || expectedHandle.length < 3) {
    return { selected: false, reason: "exact recovery identity is invalid" };
  }
  const unique = exactExistingYoutubeChannelHrefs(candidates, args);
  if (unique.length !== 1) {
    return {
      selected: false,
      reason: unique.length === 0
        ? "no exact existing-channel link was available"
        : "multiple exact existing-channel links were ambiguous",
    };
  }
  return { selected: true, href: unique[0] };
}

export async function readYoutubeChannelSwitcherCandidates(
  page: YoutubeRecoveryPage,
): Promise<YoutubeRecoveryLinkCandidate[]> {
  return await page.evaluate(() => {
    const normalizeName = (value: string) =>
      value.normalize("NFKC").trim().replace(/\s+/g, " ");
    return [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
      .map((anchor) => ({
        textLines: [
          ...String(anchor.innerText ?? "").split(/\r?\n/),
          anchor.getAttribute("aria-label") ?? "",
          anchor.getAttribute("title") ?? "",
        ].map(normalizeName).filter(Boolean),
        href: new URL(anchor.href, window.location.href).href,
      }))
      .filter((candidate) => candidate.textLines.length > 0)
      .slice(0, 500);
  });
}

/**
 * Finds one existing channel using deterministic DOM evidence only. A missing,
 * ambiguous, button-only, or mutation-looking selector fails closed so the
 * caller can surface manual recovery instead of invoking a computer-use agent.
 */
export async function selectExactExistingYoutubeChannel(
  page: YoutubeRecoveryPage,
  args: { name: string; handle: string },
): Promise<ExactExistingYoutubeChannelSelection> {
  const candidates = await readYoutubeChannelSwitcherCandidates(page);
  const result = chooseExactExistingYoutubeChannelLink(candidates, args);

  if (!result.selected) return result;
  await page.goto(result.href, { timeout: 45_000 });
  await page.waitForTimeout(2_500);
  return result;
}
