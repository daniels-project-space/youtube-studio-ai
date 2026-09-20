import { pathToFileURL } from "node:url";

export const INDIVIDUAL_DELIVERY_TASKS = Object.freeze([
  "bundle-fanout-dispatcher", "factual-review-continuation-dispatcher",
  "music-audition-continuation-dispatcher", "reviewed-data-story-initial-dispatcher",
  "route-qualification-benchmark-dispatcher", "serialized-program-episode-retry-dispatcher",
]);
export const SHARED_DELIVERY_TASK = "shared-delivery-recovery";
const relevantTasks = new Set([...INDIVIDUAL_DELIVERY_TASKS, SHARED_DELIVERY_TASK]);

function validateTarget(mode, environmentId) {
  if (mode !== "individual" && mode !== "shared") throw new Error("Expected mode must be individual or shared");
  if (typeof environmentId !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(environmentId)) {
    throw new Error("An explicit Trigger environment ID is required");
  }
}

export function verifyDeliveryRecoverySchedules({ inventory, mode, environmentId }) {
  validateTarget(mode, environmentId);
  if (!Array.isArray(inventory)) throw new Error("Schedule inventory must be an array");
  const issues = [];
  const active = [];
  const ids = new Set();
  for (const schedule of inventory) {
    if (!schedule || typeof schedule.id !== "string" || ids.has(schedule.id)) {
      throw new Error("Schedule inventory has missing or duplicate identifiers");
    }
    ids.add(schedule.id);
    if (!relevantTasks.has(schedule.task)) continue;
    if (typeof schedule.active !== "boolean" || !Array.isArray(schedule.environments)) {
      throw new Error("Recovery schedule is missing activation or environment evidence");
    }
    const environments = schedule.environments.filter(environment => environment?.id === environmentId);
    if (environments.length > 1) throw new Error("Recovery schedule repeats the target environment");
    if (!environments.length || !schedule.active) continue;
    if (environments[0].type !== "PRODUCTION") throw new Error("Recovery verifier requires a production environment");
    if (schedule.type !== "DECLARATIVE") issues.push(`${schedule.task}: unexpected manually managed schedule`);
    if (schedule.generator?.type !== "CRON" || schedule.generator.expression !== "* * * * *") {
      issues.push(`${schedule.task}: expected a one-minute cron`);
    }
    active.push(schedule.task);
  }
  const expected = mode === "shared" ? [SHARED_DELIVERY_TASK] : INDIVIDUAL_DELIVERY_TASKS;
  for (const task of relevantTasks) {
    const count = active.filter(value => value === task).length;
    const wanted = expected.includes(task) ? 1 : 0;
    if (count !== wanted) issues.push(`${task}: expected ${wanted} active schedules, observed ${count}`);
  }
  return {
    verified: issues.length === 0, mode, environmentId,
    activeRecoveryTasks: active.sort(), issues,
    // Only report the cadence projection when the inventory proves that cadence.
    scheduledStartsPer30Days: issues.length ? null : active.length * 60 * 24 * 30,
  };
}

export async function readScheduleInventory({ token, fetchImpl = fetch }) {
  if (typeof token !== "string" || !token.trim()) throw new Error("Production Trigger read credential is required");
  const inventory = [];
  let totalPages, totalCount;
  for (let page = 1; page <= 10; page++) {
    // Fixed HTTPS origin, GET only, no redirects or caller-controlled URLs.
    const response = await fetchImpl(`https://api.trigger.dev/api/v1/schedules?page=${page}&perPage=100`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Trigger schedule inventory request failed");
    const data = await response.json();
    const pagination = data?.pagination;
    if (!Array.isArray(data?.data) || !Number.isSafeInteger(pagination?.totalPages) || pagination.totalPages < 1 ||
      pagination.totalPages > 10 || pagination.currentPage !== page || !Number.isSafeInteger(pagination.count) || pagination.count < 0) {
      throw new Error("Trigger schedule inventory pagination is incomplete or exceeds its bound");
    }
    totalPages ??= pagination.totalPages;
    totalCount ??= pagination.count;
    if (pagination.totalPages !== totalPages || pagination.count !== totalCount) {
      throw new Error("Trigger schedule inventory changed during pagination; retry observation");
    }
    inventory.push(...data.data);
    if (page === totalPages) {
      if (inventory.length !== totalCount) throw new Error("Trigger schedule inventory count is incomplete");
      return inventory;
    }
  }
  throw new Error("Trigger schedule inventory exceeded its page bound");
}

export async function observeDeliveryRecovery({ mode, environmentId, token, fetchImpl = fetch }) {
  validateTarget(mode, environmentId);
  const first = verifyDeliveryRecoverySchedules({ inventory: await readScheduleInventory({ token, fetchImpl }), mode, environmentId });
  const second = verifyDeliveryRecoverySchedules({ inventory: await readScheduleInventory({ token, fetchImpl }), mode, environmentId });
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error("Recovery schedule observations disagree; retry observation");
  return { ...second, observedAt: new Date().toISOString(), scope: "schedule-inventory-only; not delivery, load, billing, or deployment verification" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== "--mode" || args[2] !== "--environment") {
      throw new Error("Usage: --mode individual|shared --environment ENVIRONMENT_ID");
    }
    const receipt = await observeDeliveryRecovery({ mode: args[1], environmentId: args[3], token: process.env.TRIGGER_SECRET_KEY_PROD });
    console.log(JSON.stringify(receipt, null, 2));
    if (!receipt.verified) process.exitCode = 1;
  } catch {
    // Network exceptions may include credential-bearing request details.
    console.error("Recovery schedule verification failed. Check mode, environment, read credentials and inventory completeness. No changes were made.");
    process.exitCode = 1;
  }
}
