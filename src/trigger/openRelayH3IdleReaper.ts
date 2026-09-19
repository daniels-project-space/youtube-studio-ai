/** Stop the exact persistent OpenRelay H3 VM after a safe idle drain. */
import { schedules } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { OpenRelayVmClient } from "@/lib/openRelay";
import {
  drainOpenRelayH3Worker,
  fetchOpenRelayH3Health,
  OPENRELAY_H3_DISK_SIZE_GB,
  OPENRELAY_H3_IDLE_SECONDS,
  OPENRELAY_H3_VM_NAME,
} from "@/lib/openRelayH3";

function required(name: string, minimumLength = 1): string {
  const value = process.env[name]?.trim() ?? "";
  if (value.length < minimumLength) throw new Error(`${name} is missing or invalid`);
  return value;
}

export const openRelayH3IdleReaper = schedules.task({
  id: "openrelay-h3-idle-reaper",
  cron: "* * * * *",
  maxDuration: 120,
  retry: { maxAttempts: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 20_000, factor: 2 },
  queue: { concurrencyLimit: 1 },
  run: async () => {
    await bootstrapSecrets(() => undefined, {
      services: ["openrelay", "youtube"],
      required: ["OPENRELAY_API_KEY", "MINIMAX_H3_OPENRELAY_VM_ID", "MINIMAX_H3_OPENRELAY_WORKER_URL", "MINIMAX_H3_OPENRELAY_WORKER_TOKEN"],
    });
    const client = new OpenRelayVmClient({ apiKey: required("OPENRELAY_API_KEY", 32) });
    const id = required("MINIMAX_H3_OPENRELAY_VM_ID", 36);
    const vm = await client.getVm(id);
    if (vm.name !== OPENRELAY_H3_VM_NAME || vm.public || vm.gpuCount !== 1 || !vm.gpuModelName.includes("A100") || vm.diskSizeGb !== OPENRELAY_H3_DISK_SIZE_GB) {
      throw new Error("refusing to manage an OpenRelay VM outside the pinned private H3 A100 / 150 GB identity");
    }
    if (vm.status !== "running") return { action: "noop", reason: `vm_${vm.status}` };
    const health = await fetchOpenRelayH3Health();
    if (health.draining) {
      await client.stopVm(id);
      return { action: "stopped", reason: "previous_drain_recovered", idleSeconds: health.idleSeconds };
    }
    if (health.busy || health.idleSeconds < OPENRELAY_H3_IDLE_SECONDS) {
      return { action: "noop", reason: health.busy ? "busy" : "below_idle_threshold", idleSeconds: health.idleSeconds };
    }
    if (!(await drainOpenRelayH3Worker())) return { action: "noop", reason: "became_busy", idleSeconds: health.idleSeconds };
    await client.stopVm(id);
    return { action: "stopped", reason: "idle_drained", idleSeconds: health.idleSeconds };
  },
});
