import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const appLayout = source("./(app)/layout.tsx");
assert.doesNotMatch(
  appLayout,
  /hasValidOperatorSession|STUDIO_SESSION_COOKIE|operator-login/,
  "the application shell must render without an operator session",
);

const retiredLogin = source("./operator-login/page.tsx");
assert.match(retiredLogin, /redirect\("\/"\)/);
assert.doesNotMatch(retiredLogin, /token|password|api\/auth\/operator/i);
assert.equal(
  existsSync(new URL("./api/auth/operator/route.ts", import.meta.url)),
  false,
  "the blocking login endpoint must remain retired",
);

assert.equal(
  existsSync(new URL("./api/operations/elevation/route.ts", import.meta.url)),
  true,
  "optional privileged operations need a dedicated non-page elevation boundary",
);

const convexToken = source("./api/auth/convex-token/route.ts");
assert.match(convexToken, /"viewer"/);
assert.match(convexToken, /ownerSession/);
assert.match(convexToken, /role\s*=\s*ownerSession\s*\?\s*"owner"\s*:\s*"viewer"/);
assert.match(convexToken, /cross-origin token request refused/);

const elevationRoute = source("./api/operations/elevation/route.ts");
assert.match(elevationRoute, /sameOriginMutation\(request\)/);
assert.match(elevationRoute, /STUDIO_SESSION_COOKIE/);
assert.match(elevationRoute, /httpOnly|sessionCookieOptions/);
assert.doesNotMatch(elevationRoute, /export async function POST|secret|password/i);

const operationsAuthorize = source("./api/operations/authorize/route.ts");
assert.match(operationsAuthorize, /createOperationsOAuthState\(\{ youtubeChannelId \}\)/);
assert.match(operationsAuthorize, /getOwnerSessionConsentUrl\(REDIRECT_URI, state\)/);
assert.match(operationsAuthorize, /OPERATIONS_OAUTH_NONCE_COOKIE/);
assert.match(operationsAuthorize, /httpOnly: true/);
assert.match(operationsAuthorize, /cross-origin owner verification refused/);

const appShell = source("../components/AppShell.tsx");
assert.match(appShell, /<OperationsAccess\s*\/>/);
const operationsAccess = source("../components/OperationsAccess.tsx");
assert.match(operationsAccess, /The studio stays readable/);
assert.match(operationsAccess, /Paid render and publish review gates remain enforced/);
assert.match(operationsAccess, /window\.location\.reload\(\)/);
assert.match(operationsAccess, /containDialogFocus/);
assert.match(operationsAccess, /event\.shiftKey/);
assert.match(operationsAccess, /previous\?\.focus\(\)/);
assert.match(operationsAccess, /Operations request timed out/);
assert.match(operationsAccess, /requestAbortRef\.current\?\.abort/);
assert.match(operationsAccess, /href="\/api\/operations\/authorize"/);
assert.match(operationsAccess, /Continue with YouTube/);
assert.match(operationsAccess, /one-use Google token/);
assert.doesNotMatch(operationsAccess, /type="password"|current-password|Operations key|secret/i);

const convexProvider = source("./ConvexClientProvider.tsx");
assert.match(
  convexProvider,
  /onClick=\{\(\) => window\.location\.reload\(\)\}/,
  "Retry must refetch the token and live subscriptions instead of linking to the current page",
);

const convexAuthorization = source("../../convex/studioFunctions.ts");
assert.match(
  convexAuthorization,
  /identity\.role === "viewer" && operation === "mutation"/,
);
assert.match(
  convexAuthorization,
  /export const mutation = authenticatedBuilder\(baseMutation, "mutation"\)/,
  "every public Convex mutation must pass through the viewer-denying builder",
);

const assetRoute = source("./api/asset-url/route.ts");
assert.doesNotMatch(assetRoute, /authorizeStudioRoute|requireStudioActor/);
assert.match(assetRoute, /key\.startsWith\(ownerPrefix\)/);
assert.match(assetRoute, /key\.includes\("\.\."\)/);
assert.match(
  assetRoute,
  /\^voicebank\\\/auditions\\\/[A-Za-z0-9_\-\[\]\{\},]+\\\.mp3\$/,
  "the public signer may admit only well-formed shared narrator auditions outside the owner prefix",
);
assert.match(assetRoute, /!key\.startsWith\(ownerPrefix\) && !sharedVoiceAudition/);

for (const route of [
  "./api/novita-render/route.ts",
  "./api/publish-intents/route.ts",
  "./api/youtube-connect/route.ts",
  "./api/youtube-revoke/route.ts",
  "./api/channel-settings/route.ts",
]) {
  assert.match(
    source(route),
    /requireStudioActor\(request\)/,
    `${route} must retain its privileged actor boundary`,
  );
}

for (const route of [
  "./api/build-channel/route.ts",
  "./api/plan-week/route.ts",
  "./api/research/route.ts",
  "./api/make-multilingual/route.ts",
  "./api/youtube-create/route.ts",
  "./api/youtube-provision/route.ts",
]) {
  assert.match(
    source(route),
    /authorizeStudioRoute\(request\)/,
    `${route} must retain its privileged route boundary`,
  );
}

const oauthCallback = source("./api/youtube-callback/route.ts");
assert.match(oauthCallback, /verifyYouTubeOAuthState\(/);
assert.match(oauthCallback, /encryptSecret\(/);
assert.match(oauthCallback, /requireInternalQuerySecret\(/);
assert.match(oauthCallback, /isOperationsOAuthState\(state\)/);
assert.match(oauthCallback, /verifyOperationsOAuthState\(/);
assert.match(oauthCallback, /isKnownOperationsOwnerChannel\(/);
assert.match(oauthCallback, /createOperatorSessionToken\(\)/);
assert.match(oauthCallback, /publishedVideoChannelIds/);

assert.doesNotMatch(
  source("./api/youtube-connect/route.ts"),
  /operator-login/,
  "privileged OAuth denial must not resurrect the retired login page",
);
assert.match(
  source("./api/youtube-connect/route.ts"),
  /new URL\("\/api\/operations\/authorize", request\.url\)/,
  "an unauthenticated Connect action must enter owner verification instead of rendering a raw 401",
);
assert.match(
  oauthCallback,
  /operationsOAuthSuccessPath\(oauthState\)/,
  "successful owner verification must continue the requested YouTube connection",
);

console.log("Public viewer access boundary regression tests passed");
