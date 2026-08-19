import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NOVITA_RENDER_JOB_STORAGE_KEY,
  NOVITA_RENDER_STATUS_MAX_MS,
  NOVITA_RENDER_STATUS_MIN_MS,
  loadPersistedNovitaRenderJob,
  novitaRenderPollDelayMs,
  persistNovitaRenderJob,
} from "@/lib/novitaRenderPolling";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.equal(
  page.match(/\/api\/novita-render\?health=1/g)?.length,
  1,
  "the read-only fleet health endpoint should be fetched once by the page effect",
);
assert.match(page, /useEffect\(\(\) => \{[\s\S]*new AbortController\(\)/);
assert.match(page, /cache: "no-store"/);
assert.match(page, /return \(\) => controller\.abort\(\)/);
assert.match(page, /isFleetHealth\(payload\) \? payload : UNAVAILABLE_FLEET_HEALTH/);
assert.match(page, /setFleetHealth\(UNAVAILABLE_FLEET_HEALTH\)/);
assert.match(page, /hasExactLtx25X2Attestation/);
assert.match(
  page,
  /assessNovitaVideoProfileRuntime\(profile\)\.ready/,
  "the console must require the same local benchmark allow-list as the worker launcher before it presents production readiness",
);
assert.match(page, /source === "direct-trigger"/);
assert.match(page, /exactLtx25Rtx4090X2 === true/);
assert.match(page, /profileIdentity === novitaVideoProfileIdentity\(profile\)/);
assert.match(page, /const launchBlocked = busy \|\| recoverableJob !== null \|\| !exactLtx25X2Ready/);

assert.match(page, /aria-label="Novita render admission readiness"/);
assert.match(page, /Checking admission…/);
assert.match(page, /exactLtx25X2Ready \? "Ready" : "Not attested"/);
assert.match(page, />Architecture ceiling</);
assert.match(page, />Verified provider quota</);
assert.match(page, />Available now</);
assert.match(page, /Orchestration design limit/);
assert.match(page, /Direct Trigger attestation/);
assert.match(page, /Contract \{attestedFleetHealth\.contract\?\.version/);
assert.match(page, /Models · Gemma/);
assert.match(page, /persistent model disk verified/);
assert.match(page, /R2 recovery/);
assert.match(page, /Render admission remains server-gated/);

assert.match(page, /verifiedGpuQuota: null/);
assert.match(page, /effectiveGpuLimit: null/);
assert.doesNotMatch(page, /verifiedGpuQuota:\s*3/);
assert.doesNotMatch(page, /three-slot Novita spot fleet/);
assert.match(page, /Shard count \(manual console cap 3\)/);

assert.match(page, /window\.confirm\(/, "paid work must retain explicit operator confirmation");
assert.match(page, /method: "POST"/, "the existing paid launch path must remain intact");
assert.match(page, /pollRender\(launch, startedAt\)/, "the paid launch must enter durable status polling");
assert.match(page, /activePoll\.current\?\.abort\(\)/);
assert.match(page, /signal: controller\.signal/);
assert.match(page, /document\.visibilityState === "hidden"/);
assert.match(page, /Resume status/);
assert.match(page, /Operator access expired\. Unlock Ops/);
assert.doesNotMatch(page, /await sleep\(10_000\)/);

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const storage = new MemoryStorage();
const startedAt = 2_000_000_000_000;
persistNovitaRenderJob(storage, {
  version: 1,
  jobId: `image-${"a".repeat(32)}`,
  phase: "image",
  profileId: "production",
  startedAt,
});
assert.deepEqual(loadPersistedNovitaRenderJob(storage, startedAt + 1_000), {
  version: 1,
  jobId: `image-${"a".repeat(32)}`,
  phase: "image",
  profileId: "production",
  startedAt,
});
assert.doesNotMatch(storage.getItem(NOVITA_RENDER_JOB_STORAGE_KEY) ?? "", /prompt|cookie|secret|token/i);
storage.setItem(NOVITA_RENDER_JOB_STORAGE_KEY, JSON.stringify({ jobId: "forged" }));
assert.equal(loadPersistedNovitaRenderJob(storage, startedAt), null);
assert.equal(storage.getItem(NOVITA_RENDER_JOB_STORAGE_KEY), null);

assert.equal(
  novitaRenderPollDelayMs({ statusBatchSeconds: 5, elapsedMs: 0, unchangedPolls: 0 }),
  NOVITA_RENDER_STATUS_MIN_MS,
);
assert.equal(
  novitaRenderPollDelayMs({ statusBatchSeconds: 30, elapsedMs: 0, unchangedPolls: 4 }),
  40_000,
);
assert.equal(
  novitaRenderPollDelayMs({ statusBatchSeconds: 90, elapsedMs: 0, unchangedPolls: 0 }),
  NOVITA_RENDER_STATUS_MAX_MS,
);
assert.equal(
  novitaRenderPollDelayMs({ statusBatchSeconds: 20, elapsedMs: 31 * 60_000, unchangedPolls: 0 }),
  NOVITA_RENDER_STATUS_MAX_MS,
);

console.log("Novita render fleet health UI contract tests passed");
