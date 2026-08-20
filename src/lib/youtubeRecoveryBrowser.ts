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

/**
 * Domains the recovery flow legitimately needs in order to render a YouTube
 * channel-switcher / channel-about / Studio page. Anything else is refused by
 * the browser context's domain policy.
 *
 * IMPORTANT (see `installYoutubeRecoveryGuards` for the full caveat): because
 * every provider MUTATION endpoint also lives on these same domains, this
 * allowlist does NOT constrain what the page may do to the account. It only
 * keeps traffic from leaving the provider's own origins.
 */
const RECOVERY_ALLOWED_DOMAINS = [
  "youtube.com",
  "www.youtube.com",
  "studio.youtube.com",
  "m.youtube.com",
  "ytimg.com",
  "i.ytimg.com",
  "s.ytimg.com",
  "ggpht.com",
  "yt3.ggpht.com",
  "googleusercontent.com",
  "yt3.googleusercontent.com",
  "gstatic.com",
  "www.gstatic.com",
  "google.com",
  "www.google.com",
  "accounts.google.com",
  "googleapis.com",
] as const;

export interface YoutubeRecoveryDomainPolicy {
  allowedDomains?: string[];
  blockedDomains?: string[];
}

export interface YoutubeRecoveryContext {
  addInitScript(script: () => void): Promise<void>;
  setDomainPolicy(policy: YoutubeRecoveryDomainPolicy | null): Promise<void>;
}

export interface YoutubeRecoveryPage {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T>;
  /** Optional: present on Stagehand 4.x pages; used to bind the guards to an existing tab. */
  addInitScript?(script: () => void): Promise<void>;
}

/**
 * Installs the recovery safety boundary before any provider page is loaded.
 *
 * ⚠ REDUCED GUARANTEE SINCE THE STAGEHAND 4.x MIGRATION — READ THIS.
 *
 * This boundary used to have TWO layers. Stagehand 3.x exposed a real Playwright
 * `BrowserContext`, so the outer layer was genuine network-level interception:
 * `context.route()` inspected and aborted every request that was not a safe
 * method or that touched a mutation URL, `context.routeWebSocket()` closed all
 * WebSockets, and a CDP `Network.setBypassServiceWorker` stopped a service
 * worker retained in the authenticated context from bypassing those routes.
 *
 * Stagehand 4.x replaced Playwright with its own CDP engine and a much narrower
 * `BrowserContext`. `route()`, `routeWebSocket()` and `newCDPSession()` DO NOT
 * EXIST in 4.x and have no public replacement, so the outer network layer is
 * GONE. What remains is:
 *
 *  - `setDomainPolicy()` — a DOMAIN-level allowlist only. It cannot express the
 *    method filter (GET/HEAD/OPTIONS) or the mutation-path blocklist, and every
 *    YouTube mutation endpoint lives on the very domains the page needs in order
 *    to render at all. It therefore does NOT constrain what the page can do to
 *    the account; it only prevents traffic to unrelated third-party origins.
 *  - `addInitScript()` — in-page patching, which now carries the ENTIRE
 *    read-only enforcement on its own: interaction suppression, the method
 *    filter and mutation-path blocklist on `fetch`/`XMLHttpRequest`, blocked
 *    form submission, beacons, WebSockets, EventSource and service-worker
 *    registration.
 *
 * RESIDUAL RISK, stated plainly. In-page patching is same-origin JavaScript and
 * is weaker than network interception:
 *  - A request issued from a context this script does not patch (a service
 *    worker that was ALREADY active in the persisted Browserbase context, a
 *    dedicated/shared worker, or a cross-origin iframe with its own realm) is
 *    not filtered. `Network.setBypassServiceWorker` used to close exactly this
 *    hole and is no longer available.
 *  - Page code that captured a native reference before this script ran, or that
 *    re-imports a clean `fetch` from a fresh same-origin iframe, can defeat the
 *    monkey-patches.
 *  - Navigations themselves are not method-filtered at the network layer; the
 *    caller is responsible for only ever calling `page.goto()` with an href that
 *    `isYoutubeRecoveryRequestAllowed()` has approved (which
 *    `selectExactExistingYoutubeChannel` does).
 *
 * The compensating controls are unchanged and remain the real safety net: the
 * recovery path never invokes an LLM agent, only navigates hrefs that passed
 * `chooseExactExistingYoutubeChannelLink()`, and its result is accepted only
 * after `proveExactActiveChannel()` verifies provider-owned metadata.
 */
export async function installYoutubeRecoveryGuards(
  context: YoutubeRecoveryContext,
  page: YoutubeRecoveryPage,
): Promise<void> {
  if (
    typeof context.addInitScript !== "function" ||
    typeof context.setDomainPolicy !== "function"
  ) {
    throw new Error("read-only YouTube recovery guards are unavailable");
  }

  // Outer layer (weak): keep traffic on provider origins. This cannot stop a
  // mutation aimed at youtube.com itself — see the caveat above.
  await context.setDomainPolicy({ allowedDomains: [...RECOVERY_ALLOWED_DOMAINS] });

  // Inner layer (now the only real enforcement): patch the page realm before
  // any provider script runs. Installed on BOTH the context (applies to every
  // page/navigation) and the already-created page, so an existing tab is
  // covered too.
  const recoveryInitScript = () => {
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
    } catch { /* best effort: a failed patch leaves this vector UNGUARDED */ }

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
    } catch { /* best effort: a failed patch leaves this vector UNGUARDED */ }

    try {
      Navigator.prototype.sendBeacon = function recoveryBeacon(): boolean {
        return false;
      };
    } catch { /* best effort: a failed patch leaves beacons UNGUARDED */ }
    try {
      HTMLFormElement.prototype.submit = function recoverySubmit(): never {
        return block("form submission blocked by read-only YouTube recovery");
      };
      HTMLFormElement.prototype.requestSubmit = function recoveryRequestSubmit(): never {
        return block("form submission blocked by read-only YouTube recovery");
      };
    } catch { /* best effort: suppressed submit events remain the fallback */ }

    // Replaces the removed `context.routeWebSocket()` layer. Page-realm only:
    // a socket opened by an already-active service worker is NOT covered.
    try {
      window.WebSocket = function recoveryWebSocket(): never {
        return block("WebSocket blocked by read-only YouTube recovery");
      } as unknown as typeof WebSocket;
    } catch { /* best effort: a failed patch leaves WebSockets UNGUARDED */ }
    try {
      window.EventSource = function recoveryEventSource(): never {
        return block("EventSource blocked by read-only YouTube recovery");
      } as unknown as typeof EventSource;
    } catch { /* best effort: a failed patch leaves EventSource UNGUARDED */ }

    // Partial stand-in for the removed CDP `Network.setBypassServiceWorker`.
    // This prevents NEW service-worker registrations and best-effort unregisters
    // existing ones, but a worker already controlling this page keeps running
    // until a reload — requests it issues itself bypass every patch above.
    try {
      const serviceWorker = navigator.serviceWorker as
        | (ServiceWorkerContainer & { register: unknown })
        | undefined;
      if (serviceWorker) {
        void serviceWorker.getRegistrations?.()
          .then((registrations) => registrations.forEach((registration) => {
            void registration.unregister().catch(() => {});
          }))
          .catch(() => {});
        serviceWorker.register = function recoveryRegister(): Promise<never> {
          return Promise.reject(
            new DOMException("service worker blocked by read-only YouTube recovery", "SecurityError"),
          );
        };
      }
    } catch { /* best effort: an active worker may still bypass these patches */ }
  };

  await context.addInitScript(recoveryInitScript);
  // Also bind to the already-created page: a context-level script is only
  // guaranteed for pages/navigations created after installation.
  if (typeof page.addInitScript === "function") {
    await page.addInitScript(recoveryInitScript);
  }
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
