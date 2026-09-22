import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { observeDeliveryRecovery } from "./verify-delivery-recovery-schedules.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
export const STUDIO_DEPLOYMENT = Object.freeze({
  healthUrl: "https://youtube-studio-ai.vercel.app/api/health",
  convexUrl: "https://astute-camel-689.convex.cloud",
  convexName: "astute-camel-689",
  triggerEnvironmentId: "cmpu4i98gfghqn70jp33s1diz",
});
export const REQUIRED_FUNCTIONS = Object.freeze({
  "yue2Auditions.js:latest": "Query",
  "yue2Auditions.js:record": "Mutation",
  "yue2Auditions.js:getSourceApproval": "Query",
  "yue2Continuations.js:createAwaiting": "Mutation",
  "yue2Continuations.js:getApproved": "Query",
  "yue2Continuations.js:verifyReleaseSource": "Query",
  "yue2Continuations.js:prepareDispatch": "Mutation",
  "yue2Continuations.js:recordDispatch": "Mutation",
});
const sha = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);

async function readJson(url, fetchImpl, token) {
  const response = await fetchImpl(url, {
    method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Read unavailable");
  }
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 256 * 1024) throw new Error("Read too large");
      chunks.push(part.value);
    }
    return { data: JSON.parse(Buffer.concat(chunks).toString("utf8")), cacheControl: response.headers.get("cache-control") };
  } finally { await reader.cancel().catch(() => undefined); }
}

async function readConvexSpec() {
  const { stdout } = await exec(process.execPath, [
    fileURLToPath(new URL("../node_modules/convex/bin/main.js", import.meta.url)),
    "function-spec", "--deployment", STUDIO_DEPLOYMENT.convexName,
  ], { cwd: root, timeout: 90_000, maxBuffer: 8 * 1024 * 1024, killSignal: "SIGKILL" });
  return JSON.parse(stdout);
}

/** Read-only rollout observations, never execution, quality or publishing approval. */
export async function verifyStudioDeployment({ revision, mode = "shared", token,
  fetchImpl = fetch, readFunctionSpec = readConvexSpec }) {
  if (!sha(revision) || !["individual", "shared"].includes(mode)) throw new Error("Invalid rollout target");
  if (typeof token !== "string" || !token.startsWith("tr_prod_")) throw new Error("Production Trigger credential required");
  const report = { schema: "studio-deployment-observation/v1", expectedRevision: revision,
    observedAt: new Date().toISOString(), checks: {}, deploymentChecksPassed: false,
    convexRevisionVerified: false, productionReadinessVerified: false };
  const check = async (name, observe) => {
    try { report.checks[name] = await observe(); }
    catch { report.checks[name] = { verified: false, issue: "observation_unavailable_or_invalid" }; }
  };
  await check("web", async () => {
    const { data, cacheControl } = await readJson(STUDIO_DEPLOYMENT.healthUrl, fetchImpl);
    if (data?.service !== "youtube-studio-ai" || data.ok !== true || !sha(data.revision)) throw new Error("Invalid health response");
    const noStore = /(?:^|,)\s*no-store\s*(?:,|$)/i.test(cacheControl ?? "");
    return { verified: data.revision === revision && noStore, revision: data.revision, noStore,
      url: STUDIO_DEPLOYMENT.healthUrl };
  });
  await check("convex", async () => {
    const spec = await readFunctionSpec();
    if (spec?.url !== STUDIO_DEPLOYMENT.convexUrl || !Array.isArray(spec.functions)) throw new Error("Wrong backend");
    const seen = new Set();
    for (const item of spec.functions) {
      if (!item || typeof item.identifier !== "string" || seen.has(item.identifier)) throw new Error("Invalid function inventory");
      seen.add(item.identifier);
    }
    const missingOrIncompatible = Object.entries(REQUIRED_FUNCTIONS).filter(([identifier, type]) =>
      !spec.functions.some(item => item.identifier === identifier && item.functionType === type && item.visibility?.kind === "public"))
      .map(([identifier]) => identifier);
    return { verified: missingOrIncompatible.length === 0, url: spec.url, functionCount: spec.functions.length,
      missingOrIncompatible, scope: "function-presence-and-kind-only; not implementation-revision or authenticated-call verification" };
  });
  await check("trigger", async () => {
    const { data } = await readJson("https://api.trigger.dev/api/v1/deployments/current", fetchImpl, token);
    if (!/^\d{8}\.\d+$/.test(data?.version ?? "") || !sha(data?.git?.commitSha) || typeof data.git.dirty !== "boolean") {
      throw new Error("Worker identity missing");
    }
    return { verified: data.status === "DEPLOYED" && data.git.commitSha === revision && data.git.dirty === false,
      version: data.version, revision: data.git.commitSha, dirty: data.git.dirty,
      deployed: data.status === "DEPLOYED" };
  });
  await check("recovery", () => observeDeliveryRecovery({ mode,
    environmentId: STUDIO_DEPLOYMENT.triggerEnvironmentId, token, fetchImpl }));
  report.deploymentChecksPassed = Object.values(report.checks).every(check => check.verified);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { revision: { type: "string" }, mode: { type: "string", default: "shared" } } });
    const report = await verifyStudioDeployment({ ...values, token: process.env.TRIGGER_SECRET_KEY_PROD });
    console.log(JSON.stringify(report, null, 2));
    if (!report.deploymentChecksPassed) process.exitCode = 1;
  } catch {
    console.error("Deployment observation failed. Supply --revision FULL_COMMIT_SHA, optional --mode shared|individual, and vault-injected Convex/production Trigger credentials. No changes were made.");
    process.exitCode = 1;
  }
}
