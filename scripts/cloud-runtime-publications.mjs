import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { impactSince } from "./deployment-impact.mjs";
import { checkCloudRelease } from "./cloud-runtime-release-policy.mjs";

export const REPOSITORY = "daniels-project-space/youtube-studio-ai";
export const RUNTIMES = Object.freeze({
  backend: { environment: "studio-runtime-convex", task: "studio-runtime-backend", target: "astute-camel-689" },
  trigger: { environment: "studio-runtime-trigger", task: "studio-runtime-trigger", target: "proj_vorkjqmnnpkzoiqqgbuu" },
});
const sha = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const nativeReceipt = /^studio-runtime-native\/v1:([a-f0-9]{64})$/;
const recipeFiles = [".github/workflows/ci.yml", ".gitignore", "scripts/cloud-runtime-publications.mjs",
  "scripts/cloud-runtime-release-policy.mjs", "scripts/deployment-inputs.mjs", "scripts/deployment-impact.mjs"];

/** Publisher changes cannot reuse a receipt for a different publishing recipe. */
export function publicationRecipe(cwd = process.cwd()) {
  const hash = createHash("sha256");
  for (const file of recipeFiles) hash.update(file).update("\0").update(readFileSync(resolve(cwd, file))).update("\0");
  return hash.digest("hex");
}

export function githubApi({ token = process.env.GH_TOKEN, fetchImpl = fetch } = {}) {
  if (!token) throw new Error("GitHub publication token is unavailable");
  return async (path, body) => {
    if (!path.startsWith(`/repos/${REPOSITORY}/deployments`)) throw new Error("Unexpected publication API path");
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Never propagate credential-bearing request URLs, response bodies or SDK errors.
    if (!response.ok) throw new Error(`GitHub publication API returned ${response.status}`);
    return response.json();
  };
}

function validReceipt(deployment, layer, recipe) {
  const runtime = RUNTIMES[layer], payload = deployment?.payload;
  return runtime && id(deployment.id) && sha(deployment.sha) && deployment.environment === runtime.environment &&
    deployment.task === runtime.task && deployment.creator?.login === "github-actions[bot]" &&
    payload?.version === 1 && payload.repository === REPOSITORY && payload.layer === layer &&
    payload.target === runtime.target && payload.revision === deployment.sha &&
    /^[a-f0-9]{64}$/.test(payload.beforeNative ?? "") &&
    /^[a-f0-9]{64}$/.test(payload.recipe ?? "") && (recipe === undefined || payload.recipe === recipe);
}

const canonical = value => JSON.stringify(value && typeof value === "object"
  ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v)))
    : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
const fingerprint = value => createHash("sha256").update(canonical(value)).digest("hex");

/** Read native identity too: ongoing manual development must not be overwritten
 * merely because a GitHub receipt still describes an older deployment. */
export async function observeNativeRuntime(layer, { env = process.env, cwd = process.cwd(), fetchImpl = fetch } = {}) {
  const read = async (url, options) => {
    const response = await fetchImpl(url, { ...options, redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error("Native runtime identity is unavailable");
    return response.json();
  };
  if (layer === "backend") {
    if (!env.CONVEX_DEPLOY_KEY || ["ts", "js", "mts", "mjs", "cts", "cjs"].some(ext => existsSync(resolve(cwd, `convex/convex.config.${ext}`)))) {
      throw new Error("Canonical root deployment identity cannot be verified");
    }
    const version = JSON.parse(readFileSync(resolve(cwd, "package-lock.json"))).packages["node_modules/convex"].version;
    const state = await read("https://astute-camel-689.convex.cloud/api/get_config_hashes", {
      method: "POST", headers: { Authorization: `Convex ${env.CONVEX_DEPLOY_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ version, adminKey: env.CONVEX_DEPLOY_KEY }),
    });
    if (!state.config || !state.moduleHashes || !state.udfServerVersion) throw new Error("Incomplete native function identity");
    // Module order is not semantic; retain names/hashes and every other field.
    if (Array.isArray(state.moduleHashes)) state.moduleHashes.sort((a, b) => canonical(a).localeCompare(canonical(b)));
    return { fingerprint: fingerprint(state), status: "DEPLOYED" };
  }
  if (layer !== "trigger" || !env.TRIGGER_ACCESS_TOKEN) throw new Error("Canonical worker identity cannot be verified");
  const binding = await read("https://api.trigger.dev/api/v1/projects/proj_vorkjqmnnpkzoiqqgbuu/prod", {
    headers: { Authorization: `Bearer ${env.TRIGGER_ACCESS_TOKEN}` },
  });
  if (typeof binding.apiKey !== "string" || !binding.apiKey) throw new Error("Worker environment identity is unavailable");
  const deployments = await read("https://api.trigger.dev/api/v1/deployments", {
    headers: { Authorization: `Bearer ${binding.apiKey}` },
  });
  const latest = deployments.data?.[0];
  if (!latest || typeof latest.id !== "string" || typeof latest.version !== "string" || typeof latest.status !== "string") {
    throw new Error("Worker deployment identity is incomplete");
  }
  return { fingerprint: fingerprint({ id: latest.id, version: latest.version, status: latest.status,
    commit: latest.git?.commitSha ?? null }), status: latest.status, revision: latest.git?.commitSha };
}

/** Compare with the latest attempt, not the previous push or an older success.
 * A pending/failed later attempt may already have changed the remote runtime. */
export async function planPublications({ api, cwd = process.cwd(), head = "HEAD", force = false,
  recipe = publicationRecipe(cwd), impact = impactSince, observe = layer => observeNativeRuntime(layer, { cwd }) } = {}) {
  if (!api) throw new Error("Publication observation API is required");
  const entries = await Promise.all(Object.entries(RUNTIMES).map(async ([layer, runtime]) => {
    let unfinishedNative;
    let decision = force ? { deploy: true, reason: "manual-runtime-redeployment" }
      : { deploy: false, held: true, reason: "missing-publication-evidence-manual-bootstrap-required" };
    if (!force) {
      try {
        const query = new URLSearchParams({ environment: runtime.environment, task: runtime.task, per_page: "1" });
        const deployments = await api(`/repos/${REPOSITORY}/deployments?${query}`);
        if (!Array.isArray(deployments)) throw new Error("Invalid publication list");
        const latest = deployments[0];
        if (latest) {
          if (!validReceipt(latest, layer)) decision.reason = "unqualified-publication-receipt";
          else {
            const statuses = await api(`/repos/${REPOSITORY}/deployments/${latest.id}/statuses?per_page=1`);
            if (!Array.isArray(statuses) || statuses[0]?.creator?.login !== "github-actions[bot]") {
              decision.reason = "unqualified-publication-status";
            } else if (statuses[0]?.state !== "success") {
              // The latest attempt belongs to this publisher, so a failed or
              // interrupted attempt remains eligible for the existing retry.
              decision = { deploy: true, reason: "latest-publication-not-successful" };
              unfinishedNative = latest.payload.beforeNative;
            }
            else {
              const expectedNative = nativeReceipt.exec(statuses[0].description ?? "")?.[1];
              if (!expectedNative) decision.reason = "missing-native-publication-evidence";
              else {
                const delta = impact(latest.sha, { cwd, head });
                const changedRecipe = latest.payload.recipe !== recipe;
                const needsWrite = changedRecipe || delta[layer] !== false;
                if (!needsWrite) {
                  // Unchanged managed inputs require no write or native read.
                  // Leave concurrent manual work alone without claiming the
                  // live runtime still equals the historical source receipt.
                  decision = { deploy: false, reason: "unchanged-managed-inputs-native-preserved", baseline: latest.sha, receipt: latest.id };
                } else {
                  const native = await observe(layer);
                  if (native.fingerprint !== expectedNative) decision.reason = "native-runtime-changed-outside-publisher";
                  else decision = { deploy: true, reason: changedRecipe ? "publisher-recipe-changed" : delta.reason,
                    baseline: latest.sha, receipt: latest.id, expectedNative: native.fingerprint };
                }
              }
            }
          }
        }
      } catch { decision = { deploy: false, held: true, reason: "unavailable-publication-evidence" }; }
    }
    if (decision.deploy && !decision.expectedNative) {
      try {
        const native = await observe(layer);
        if (!/^[a-f0-9]{64}$/.test(native.fingerprint)) throw new Error("Missing native identity");
        if (unfinishedNative && native.fingerprint !== unfinishedNative) {
          decision = { deploy: false, held: true, reason: "native-runtime-changed-during-unfinished-publication" };
        } else decision.expectedNative = native.fingerprint;
      } catch { decision = { deploy: false, held: true, reason: "unavailable-native-runtime-identity" }; }
    }
    return [layer, decision];
  }));
  const plan = Object.fromEntries(entries);
  return { ...plan, any: entries.some(([, decision]) => decision.deploy), recipe };
}

export function requireRuntimeCredentials(plan, env = process.env) {
  if (plan.backend.held || plan.trigger.held) throw new Error("Cloud publication held: native baseline requires review or explicit manual bootstrap");
  const missing = [];
  if (plan.backend.deploy && !env.CONVEX_DEPLOY_KEY) missing.push("CONVEX_DEPLOY_KEY");
  if (plan.trigger.deploy && !env.TRIGGER_ACCESS_TOKEN) missing.push("TRIGGER_ACCESS_TOKEN");
  if (missing.length) throw new Error(`Cloud publication held: missing ${missing.join(" and ")}`);
}

function trustedWorkflow(env, cwd) {
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== "refs/heads/main" ||
      !["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME) || !sha(env.GITHUB_SHA) ||
      !/^\d+$/.test(env.GITHUB_RUN_ID ?? "") || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? "")) {
    throw new Error("Cloud publication held: a trusted main workflow is required");
  }
  const checkedOut = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (checkedOut !== env.GITHUB_SHA) throw new Error("Cloud publication held: checkout differs from the workflow revision");
}

export async function recordPublication({ api, layer, deploymentId, complete = false, cwd = process.cwd(),
  env = process.env, recipe = publicationRecipe(cwd), admit = checkCloudRelease,
  observe = runtimeLayer => observeNativeRuntime(runtimeLayer, { env, cwd }) } = {}) {
  const runtime = RUNTIMES[layer];
  if (!runtime || !api) throw new Error("Invalid runtime publication request");
  trustedWorkflow(env, cwd);
  if (complete) {
    if (!id(deploymentId)) throw new Error("Publication attempt is unavailable");
    const deployment = await api(`/repos/${REPOSITORY}/deployments/${Number(deploymentId)}`);
    if (!validReceipt(deployment, layer, recipe) || deployment.sha !== env.GITHUB_SHA ||
        deployment.payload.workflowRun !== env.GITHUB_RUN_ID || deployment.payload.workflowAttempt !== env.GITHUB_RUN_ATTEMPT) {
      throw new Error("Publication attempt does not belong to this runtime, revision and workflow attempt");
    }
    const native = await observe(layer);
    if (native.status !== "DEPLOYED" || !/^[a-f0-9]{64}$/.test(native.fingerprint)) throw new Error("Native publication is not deployed");
    if (layer === "trigger" && native.revision !== env.GITHUB_SHA) throw new Error("Worker deployment does not match the workflow revision");
    await api(`/repos/${REPOSITORY}/deployments/${Number(deploymentId)}/statuses`, {
      state: "success", auto_inactive: false,
      log_url: `https://github.com/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
      description: `studio-runtime-native/v1:${native.fingerprint}`,
    });
    return Number(deploymentId);
  }
  // This is immediately before each runtime write, including the second runtime.
  if (!admit({ cwd, env }).deploy) throw new Error("Cloud publication held: main superseded this revision");
  const native = await observe(layer);
  if (native.status !== "DEPLOYED" && !/FAIL|CANCEL/.test(native.status)) throw new Error("Native publication is still in progress");
  if (!/^[a-f0-9]{64}$/.test(env.PUBLICATION_EXPECTED_NATIVE ?? "") || native.fingerprint !== env.PUBLICATION_EXPECTED_NATIVE) {
    throw new Error("Native runtime changed after publication planning");
  }
  const deployment = await api(`/repos/${REPOSITORY}/deployments`, {
    ref: env.GITHUB_SHA, task: runtime.task, environment: runtime.environment,
    auto_merge: false, required_contexts: [], transient_environment: false, production_environment: true,
    description: "Runtime publication attempt after the complete CI quality gate",
    payload: { version: 1, repository: REPOSITORY, layer, target: runtime.target, revision: env.GITHUB_SHA,
      recipe, beforeNative: native.fingerprint, workflowRun: env.GITHUB_RUN_ID, workflowAttempt: env.GITHUB_RUN_ATTEMPT },
  });
  if (!validReceipt(deployment, layer, recipe) || deployment.sha !== env.GITHUB_SHA) throw new Error("Unverified publication attempt");
  await api(`/repos/${REPOSITORY}/deployments/${deployment.id}/statuses`, { state: "in_progress", auto_inactive: false });
  return deployment.id;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const action = process.argv[2], env = process.env;
    const api = githubApi();
    trustedWorkflow(env, process.cwd());
    if (action === "plan") {
      const plan = await planPublications({ api, force: env.GITHUB_EVENT_NAME === "workflow_dispatch" });
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,
        `Runtime publication plan: Convex **${plan.backend.held ? "held" : plan.backend.deploy ? "publish" : "skip"}** (${plan.backend.reason}); Trigger **${plan.trigger.held ? "held" : plan.trigger.deploy ? "publish" : "skip"}** (${plan.trigger.reason}).\n`);
      requireRuntimeCredentials(plan);
      if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT,
        `backend=${plan.backend.deploy}\ntrigger=${plan.trigger.deploy}\nany=${plan.any}\n` +
        `backend_native=${plan.backend.expectedNative ?? ""}\ntrigger_native=${plan.trigger.expectedNative ?? ""}\n`);
      console.log(JSON.stringify(plan));
    } else if (action === "start" || action === "complete") {
      const result = await recordPublication({ api, layer: env.PUBLICATION_LAYER,
        deploymentId: env.PUBLICATION_DEPLOYMENT_ID, complete: action === "complete" });
      if (action === "start" && env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `deployment=${result}\n`);
      console.log(JSON.stringify({ action, layer: env.PUBLICATION_LAYER, deployment: result }));
    } else throw new Error("Unknown publication action");
  } catch {
    console.error("Cloud publication held: runtime evidence, credentials or main admission could not be verified. No success receipt was issued.");
    process.exitCode = 1;
  }
}
