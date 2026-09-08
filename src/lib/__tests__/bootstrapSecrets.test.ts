import assert from "node:assert/strict";
import { bootstrapSecrets } from "../bootstrap";

async function main() {
  const originalFetch = globalThis.fetch;
  const envKeys = [
    "VAULT_ACCESS_TOKEN", "SALAD_API_KEY", "SALAD_ORG", "SALAD_PROJECT",
    "BOOTSTRAP_SHARED_FIXTURE", "BOOTSTRAP_RETRY_FIXTURE", "BOOTSTRAP_MISSING_FIXTURE",
    "TELEGRAM_CHAT_ID", "TELEGRAM_ADMIN_CHAT_ID",
  ];
  const savedEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  const reads = new Map<string, number>();
  const logs: string[] = [];
  let failSalad = true;
  let failOpenrouter = true;
  const secretSentinel = "NEVER-LOG-THIS-CREDENTIAL";

  try {
    for (const key of envKeys) delete process.env[key];
    process.env.VAULT_ACCESS_TOKEN = "fixture-token";
    process.env.SALAD_ORG = "explicit-env-wins";
    process.env.TELEGRAM_ADMIN_CHAT_ID = "fixture-chat";
    globalThis.fetch = (async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as {
        path: string; args: { service: string; vaultToken: string };
      };
      assert.equal(request.path, "secrets:listByService");
      assert.equal(request.args.vaultToken, "fixture-token");
      const service = request.args.service;
      reads.set(service, (reads.get(service) ?? 0) + 1);
      // Make concurrent callers overlap at the actual vault boundary.
      await new Promise((resolve) => setTimeout(resolve, 2));
      if ((service === "salad" && failSalad) || (service === "openrouter" && failOpenrouter)) {
        return Response.json({ status: "error", errorMessage: secretSentinel });
      }
      const entries = service === "salad"
        ? { SALAD_API_KEY: secretSentinel, SALAD_ORG: "vault-org", SALAD_PROJECT: "fixture-project" }
        : service === "openrouter"
          ? { BOOTSTRAP_RETRY_FIXTURE: "recovered" }
          : { BOOTSTRAP_SHARED_FIXTURE: service };
      return Response.json({
        status: "success",
        value: Object.entries(entries).map(([keyName, value]) => ({ service, keyName, value })),
      });
    }) as typeof fetch;
    const log = (message: string, extra?: Record<string, unknown>) => logs.push(JSON.stringify({ message, extra }));

    const failedCalls = await Promise.allSettled(Array.from({ length: 8 }, () => bootstrapSecrets(log, {
      services: ["salad", "salad"], required: ["SALAD_API_KEY"],
    })));
    assert.equal(reads.get("salad"), 1, "eight cold callers must share one vault read even when it fails");
    assert.ok(failedCalls.every((result) => result.status === "rejected"), "required keys must fail closed for every waiter");
    assert.equal(reads.size, 1, "Salad bootstrap must not fetch unrelated credentials");
    assert.ok(!logs.join("\n").includes(secretSentinel), "vault error bodies must not leak into logs");

    failSalad = false;
    await Promise.all(Array.from({ length: 8 }, () => bootstrapSecrets(log, {
      services: ["salad"], required: ["SALAD_API_KEY", "SALAD_ORG", "SALAD_PROJECT"],
    })));
    assert.equal(reads.get("salad"), 2, "a failure must remain retryable without duplicate requests");
    assert.equal(process.env.SALAD_ORG, "explicit-env-wins", "vault values must not overwrite deployment overrides");
    assert.equal(process.env.SALAD_API_KEY, secretSentinel);
    assert.deepEqual(await bootstrapSecrets(log, { services: ["salad"] }), []);
    assert.equal(reads.get("salad"), 2, "successful hydration must remain cached");

    const beforeRejectedService = [...reads.entries()];
    await assert.rejects(bootstrapSecrets(log, {
      services: ["cloudflare", "gemini"] as never,
    }), /unsupported vault service/);
    assert.deepEqual([...reads.entries()], beforeRejectedService, "forged service lists fail before any vault request");

    await Promise.all(Array.from({ length: 4 }, () => bootstrapSecrets(log)));
    assert.ok(reads.size > 10, "exercise the real default service list, not a substitute bootstrap");
    for (const [service, count] of reads) {
      assert.equal(count, service === "salad" ? 2 : 1, `${service}: concurrent general bootstrap must deduplicate`);
    }
    assert.equal(reads.has("gemini"), false, "generic bootstrap cannot hydrate sealed thumbnail credentials");
    assert.equal(process.env.BOOTSTRAP_SHARED_FIXTURE, "cloudflare", "default service order must preserve alias precedence");
    assert.equal(process.env.TELEGRAM_CHAT_ID, "fixture-chat", "existing admin chat fallback remains intact");

    failOpenrouter = false;
    const countBeforeRetry = [...reads.values()].reduce((sum, count) => sum + count, 0);
    await bootstrapSecrets(log, { required: ["BOOTSTRAP_RETRY_FIXTURE"] });
    const countAfterRetry = [...reads.values()].reduce((sum, count) => sum + count, 0);
    assert.equal(countAfterRetry - countBeforeRetry, 1, "only the failed service is read again");
    assert.equal(process.env.BOOTSTRAP_RETRY_FIXTURE, "recovered");
    await assert.rejects(bootstrapSecrets(log, {
      services: ["salad"], required: ["BOOTSTRAP_MISSING_FIXTURE"],
    }), /CRITICAL keys missing/, "cached hydration must still validate each caller's required keys");
    assert.ok(!logs.join("\n").includes(secretSentinel), "successful and failed hydration logs contain names only");
    console.log("bootstrapSecrets: concurrent, retry, scoped-vault, precedence, required-key, and secret-boundary tests passed");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
