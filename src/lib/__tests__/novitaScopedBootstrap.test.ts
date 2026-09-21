import assert from "node:assert/strict";
import { directNovitaFleetHealth } from "@/lib/novitaDirectRender";
import { hasNovitaRenderBridge, getNovitaRenderStatus } from "@/lib/novitaRenderFarm";

async function main() {
  const originalFetch = globalThis.fetch;
  const keys = new Set(["VAULT_ACCESS_TOKEN", "NOVITA_RENDER_FARM_API", "NOVITA_RENDER_FARM_TOKEN",
    ...Object.keys(process.env).filter(key => key.startsWith("NOVITA_") || key.startsWith("R2_"))]);
  const saved = new Map([...keys].map(key => [key, process.env[key]]));
  const services: string[] = [];
  try {
    for (const key of keys) delete process.env[key];
    process.env.VAULT_ACCESS_TOKEN = "scoped-vault-fixture";
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.path, "secrets:listByService", "no provider request is allowed in this fixture");
      services.push(body.args.service);
      return Response.json({ status: "success", value: [] });
    };
    assert.equal(await hasNovitaRenderBridge(), false);
    assert.deepEqual(services, ["cloudflare", "novita"], "readiness must not hydrate unrelated providers");
    const health = await directNovitaFleetHealth();
    assert.equal(health.ready, false);
    assert.ok(health.blockers.length > 0, "missing configuration must not become readiness");
    process.env.NOVITA_RENDER_FARM_API = "https://retired.invalid";
    process.env.NOVITA_RENDER_FARM_TOKEN = "t".repeat(40);
    await assert.rejects(getNovitaRenderStatus(`image-${"a".repeat(32)}`), /legacy Novita bridge is disabled/);
    assert.deepEqual(services, ["cloudflare", "novita"], "nested helpers reuse the same scoped reads without widening");
    console.log("NOVITA SCOPED BOOTSTRAP PASS: actual readiness/helpers, two vault reads, no provider requests");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
