import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GET, POST } from "./route";

const INTERNAL_TOKEN = "studio-test-service-token-that-is-long-enough";

function request(args: { method?: "GET" | "POST"; health?: boolean; authenticated?: boolean } = {}): Request {
  const method = args.method ?? "GET";
  const url = `https://studio.test/api/novita-render${args.health ? "?health=1" : ""}`;
  return new Request(url, {
    method,
    headers: args.authenticated === false ? undefined : { authorization: `Bearer ${INTERNAL_TOKEN}` },
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function main() {
  const originalFetch = globalThis.fetch;
  const originalInternalToken = process.env.STUDIO_INTERNAL_API_TOKEN;
  const originalBridgeApi = process.env.NOVITA_RENDER_FARM_API;
  const originalBridgeToken = process.env.NOVITA_RENDER_FARM_TOKEN;
  process.env.STUDIO_INTERNAL_API_TOKEN = INTERNAL_TOKEN;
  // A retired bridge configuration must have no effect on the Vercel route.
  process.env.NOVITA_RENDER_FARM_API = "https://retired.example/render";
  process.env.NOVITA_RENDER_FARM_TOKEN = "retired-bridge-token-that-must-not-be-read";

  try {
    let providerCalls = 0;
    globalThis.fetch = async () => {
      providerCalls += 1;
      throw new Error("Vercel Novita route must not call a provider");
    };

    const healthResponse = await GET(request({ health: true }));
    assert.equal(healthResponse.status, 200);
    assert.equal(healthResponse.headers.get("cache-control"), "no-store");
    const health = await healthResponse.json() as {
      ok: boolean;
      ready: boolean;
      checkedAt: string;
      attestation: {
        source: string;
        profileIdentity: string | null;
        exactLtx25Rtx4090X2: boolean;
      };
      controlPlane: Record<string, unknown>;
    };
    assert.equal(providerCalls, 0);
    assert.equal(health.ok, true);
    assert.equal(health.ready, false);
    assert.match(health.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(health.attestation, {
      source: "studio-static",
      profileIdentity: null,
      exactLtx25Rtx4090X2: false,
    });
    assert.deepEqual(health.controlPlane, {
      provider: "novita",
      execution: "trigger-cloud-only",
      gpuSku: "RTX 4090",
      gpuCountPerWorker: 1,
      concurrencyCeiling: 8,
      manualLaunch: "disabled",
      billingClosure: "provider deletion verification required",
    });

    const disabledGet = await GET(request());
    assert.equal(disabledGet.status, 410);
    assert.deepEqual((await disabledGet.json()).controlPlane, health.controlPlane);

    const disabledPost = await POST(request({ method: "POST" }));
    assert.equal(disabledPost.status, 410);
    assert.deepEqual((await disabledPost.json()).controlPlane, health.controlPlane);

    const unauthorizedGet = await GET(request({ health: true, authenticated: false }));
    assert.equal(unauthorizedGet.status, 401);
    const unauthorizedPost = await POST(request({ method: "POST", authenticated: false }));
    assert.equal(unauthorizedPost.status, 401);
    assert.equal(providerCalls, 0, "authentication and all route paths must avoid provider access");

    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    assert.match(source, /await requireStudioActor\(request\);[\s\S]*searchParams\.get\("health"\) === "1"/);
    assert.match(source, /execution: "trigger-cloud-only"/);
    assert.match(source, /gpuSku: NOVITA_REQUIRED_GPU_SKU/);
    assert.match(source, /source: "studio-static"/);
    assert.match(source, /exactLtx25Rtx4090X2: false/);
    assert.doesNotMatch(source, /NOVITA_RENDER_FARM_(API|TOKEN)/);
    assert.doesNotMatch(source, /bootstrapSecrets|getNovitaRenderStatus|launchImages|fetch\s*\(/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("STUDIO_INTERNAL_API_TOKEN", originalInternalToken);
    restoreEnv("NOVITA_RENDER_FARM_API", originalBridgeApi);
    restoreEnv("NOVITA_RENDER_FARM_TOKEN", originalBridgeToken);
  }

  console.log("Novita render cloud-only route tests passed");
}

void main();
