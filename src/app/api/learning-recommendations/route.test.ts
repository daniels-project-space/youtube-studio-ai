import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";

import { GET, POST } from "./route";
import {
  createOperatorSessionToken,
  STUDIO_SESSION_COOKIE,
} from "@/lib/operatorSession";

const endpoint = "https://studio.test/api/learning-recommendations";
const serviceToken = "learning-route-service-token-that-is-long-enough";
const ownerId = "owner-learning-route-test";
const envNames = [
  "STUDIO_SESSION_SECRET",
  "STUDIO_INTERNAL_API_TOKEN",
  "STUDIO_OWNER_ID",
  "VAULT_ACCESS_TOKEN",
  "VAULT_URL",
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_URL",
  "INTERNAL_QUERY_SECRET",
  "STUDIO_CONVEX_JWT_PRIVATE_KEY",
] as const;

function rearmPayload() {
  return {
    action: "rearm_show_bible_no_dispatch",
    claimId: "showBibleProposalClaims:claim-test",
    reason: "The worker stopped before provider dispatch.",
    evidence: "The durable trace confirms that no provider request was attempted.",
    verifiedNoDispatch: true,
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function requestForService(): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(rearmPayload()),
  });
}

function requestForOwner(sessionToken: string): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      cookie: `${STUDIO_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}`,
      origin: "https://studio.test",
      "content-type": "application/json",
    },
    body: JSON.stringify(rearmPayload()),
  });
}

function getRequestForOwner(sessionToken: string): Request {
  return new Request(endpoint, {
    headers: {
      cookie: `${STUDIO_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}`,
    },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function main(): Promise<void> {
  const originalEnv = new Map(
    envNames.map((name) => [name, process.env[name]]),
  );
  const originalFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

  process.env.STUDIO_SESSION_SECRET = Buffer.alloc(32, 31).toString("base64url");
  process.env.STUDIO_INTERNAL_API_TOKEN = serviceToken;
  process.env.STUDIO_OWNER_ID = ownerId;
  process.env.VAULT_ACCESS_TOKEN = "vault-access-token-for-learning-route-test";
  process.env.VAULT_URL = "https://vault.test";
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://convex.test";
  delete process.env.CONVEX_URL;
  process.env.INTERNAL_QUERY_SECRET = "internal-learning-route-test-secret";
  process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();

  try {
    let fetchCalls = 0;
    const convexBodies: string[] = [];
    const convexQueryBodies: string[] = [];
    globalThis.fetch = (async (input, init) => {
      fetchCalls += 1;
      const url = requestUrl(input);
      if (url.startsWith("https://vault.test/api/query")) {
        return Response.json({ status: "success", value: [] });
      }
      if (url.startsWith("https://convex.test/api/mutation")) {
        convexBodies.push(typeof init?.body === "string" ? init.body : "");
        return Response.json({
          status: "success",
          value: { _id: "showBibleProposalClaims:claim-test", status: "claimed" },
        });
      }
      if (url.startsWith("https://convex.test/api/query")) {
        const body = typeof init?.body === "string" ? init.body : "";
        convexQueryBodies.push(body);
        if (body.includes("learningGovernance:listForOwner")) {
          return Response.json({ status: "success", value: [] });
        }
        if (body.includes("learningGovernance:listShowBibleClaims")) {
          return Response.json({
            status: "success",
            value: [{
              claimId: "showBibleProposalClaims:claim-test",
              status: "provider_started",
              rearmAllowed: true,
            }],
          });
        }
      }
      throw new Error(`unexpected learning-recommendations fetch: ${url}`);
    }) as typeof fetch;

    const serviceResponse = await POST(requestForService());
    assert.equal(serviceResponse.status, 403);
    assert.match(
      String((await serviceResponse.json() as { error?: string }).error),
      /interactive owner session/i,
    );
    assert.equal(
      fetchCalls,
      0,
      "a service credential must be rejected before vault or Convex access",
    );

    const sessionToken = await createOperatorSessionToken();
    const getResponse = await GET(getRequestForOwner(sessionToken));
    assert.equal(getResponse.status, 200);
    assert.deepEqual(await getResponse.json(), {
      ok: true,
      recommendations: [],
      showBibleClaims: [{
        claimId: "showBibleProposalClaims:claim-test",
        status: "provider_started",
        rearmAllowed: true,
      }],
    });
    assert.equal(convexQueryBodies.length, 2, "the owner GET reads both governance lists");
    assert.ok(
      convexQueryBodies.some((body) => body.includes("learningGovernance:listForOwner")),
    );
    assert.ok(
      convexQueryBodies.some((body) => body.includes("learningGovernance:listShowBibleClaims")),
    );

    const ownerResponse = await POST(requestForOwner(sessionToken));
    assert.equal(ownerResponse.status, 200);
    assert.deepEqual(await ownerResponse.json(), {
      ok: true,
      showBibleClaim: {
        _id: "showBibleProposalClaims:claim-test",
        status: "claimed",
      },
    });
    assert.equal(convexBodies.length, 1, "the owner rearm reaches one mutation");
    assert.match(
      convexBodies[0] ?? "",
      /learningGovernance:resolveShowBibleProviderStartedNoDispatch/,
    );
    assert.match(convexBodies[0] ?? "", /showBibleProposalClaims:claim-test/);
    assert.match(convexBodies[0] ?? "", /verifiedNoDispatch/);
    assert.match(convexBodies[0] ?? "", new RegExp(`session:${ownerId}`));

    const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    assert.match(routeSource, /listShowBibleClaims/);
    assert.match(routeSource, /actor\.authKind !== "session" \|\| actor\.role !== "owner"/);
    assert.match(routeSource, /rearm_show_bible_no_dispatch/);

    const settingsSource = readFileSync(
      new URL("../../(app)/settings/page.tsx", import.meta.url),
      "utf8",
    );
    assert.match(settingsSource, /showBibleClaims\?: ShowBibleClaimRow\[\]/);
    assert.match(settingsSource, /Show Bible proposal status/);
    const rearmConditional = settingsSource.indexOf("{claim.rearmAllowed ? (");
    const recoveryAction = settingsSource.indexOf(
      "Review no-dispatch recovery",
      rearmConditional,
    );
    const rearmConditionalEnd = settingsSource.indexOf(") : null}", recoveryAction);
    assert.ok(rearmConditional >= 0, "only an explicitly eligible claim may show recovery controls");
    assert.ok(recoveryAction > rearmConditional, "the recovery action is inside the eligibility branch");
    assert.ok(rearmConditionalEnd > recoveryAction, "a non-rearmable claim has no recovery action");
    assert.match(settingsSource, /verifiedNoDispatch: true/);
    assert.match(
      settingsSource,
      /provider_dispatch_started:[\s\S]*will not be retried automatically/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of originalEnv) restoreEnv(name, value);
  }

  console.log("Show Bible owner recovery route and settings tests passed");
}

void main();
